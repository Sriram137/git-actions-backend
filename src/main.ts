import * as core from "@actions/core";
import * as github from "@actions/github";
import * as yaml from "js-yaml";
import { Minimatch } from "minimatch";
import _ from 'lodash';

async function run() {
  try {
    const token = core.getInput('access-token', {required: true});
    const org = core.getInput('org', { required: true });
    const coreReviewers = core.getInput('core-reviewers');
    const additionalReviewers = core.getInput('additional-reviewers');
    const reviewTeamSlug = core.getInput('review-team-slug', { required: true });

    if (!token || !org || !reviewTeamSlug) {
      core.debug('Please provide access-token, org and review-team-slug');
      return;
    }

    const prNumber = getPrNumber();
    if (!prNumber) {
      core.debug('Could not get pull request number from context');
      return;
    }

    const teamName = `${_.capitalize(reviewTeamSlug)}-Team`;
    const client = new github.GitHub(token);
    if (github.context.eventName === 'pull_request_review') {
      await reRunFrontendCheck(client);
      return;
    }

    console.log(`PROCESSING: Fetching changed files for pr #${prNumber}`);
    const changedFiles: string[] = await getChangedFiles(client, prNumber);
    const hasChanges: boolean = hasStyleChanges(changedFiles);

    if (hasChanges) {
      console.log(`STATUS: Checking ${teamName} approval status`);
      const approvedReviewers: string[] = await getApprovedReviews(client, prNumber);
      let approvalNeeded: boolean = true;
      if (approvedReviewers.length) {
        console.log(`Pull request is approved by ${approvedReviewers.join(', ')}`);
        const reviewTeamMembers: string[] = await getReviewers(client, org, reviewTeamSlug);
        if (_.isEmpty(reviewTeamMembers)) {
          core.setFailed(`${teamName} has no members`);
          return;
        } else if (_.intersection(approvedReviewers, [...reviewTeamMembers, ..._.split(additionalReviewers, '')]).length > 0) {
          approvalNeeded = false;
        }
      }

      if (approvalNeeded) {
        await addReviewers(client, prNumber, coreReviewers);
        core.setFailed(`${teamName} approval needed`);
      } else {
        console.log(`${teamName} approved changes.`);
      }
    } else {
      console.log(`No approval needed from ${teamName}`);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function getReviewers(client: github.GitHub, org: string, reviewTeamSlug: string): Promise<string[]> {
  const team = await client.teams.getByName({
    org,
    team_slug: reviewTeamSlug,
  });
  if (!team) {
    return [];
  }
  const teamId = team.data.id;
  const members = await client.teams.listMembers({
    team_id: teamId,
  });
  return _.map(members.data, 'login');
}

async function getApprovedReviews(client: github.GitHub, prNumber: number): Promise<string[]> {
  const listReviewRequests = await client.pulls.listReviews({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber,
  });
  return _(listReviewRequests.data)
    .filter({ state: 'APPROVED' })
    .map('user.login')
    .uniq()
    .value();
}

function getPrNumber(): number | undefined {
  const payload = github.context.payload;
  let pullRequest = payload.pull_request;
  if (!pullRequest && payload.action === 'rerequested') {
    pullRequest = payload.check_suite.pull_requests[0];
  }
  if (!pullRequest) {
    return undefined;
  }
  return pullRequest.number;
}

async function getChangedFiles(
  client: github.GitHub,
  prNumber: number
): Promise<string[]> {
  const listFilesResponse = await client.pulls.listFiles({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber
  });
  const changedFiles = listFilesResponse.data.map(f => f.filename);
  return changedFiles;
}

function hasStyleChanges(changedFiles: string[]): boolean {
  if (_.isEmpty(changedFiles)) {
    return false
  }
  return _.some(changedFiles, fileName => _.includes(fileName, 'app/modules/Common'));
  // return _.some(changedFiles, fileName => (
  //   _.endsWith(fileName, '.scss')
  //   || _.endsWith(fileName, '.css')
  //   || _.includes(fileName, 'app/modules/Common')
  // ));
}

async function reRunFrontendCheck(client: github.GitHub) {
  console.log('Finding Frontend Review Check');
  const checkListResponse = await client.checks.listForRef({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    ref: github.context.sha,
    check_name: 'FrontendReviewCheck',
  });

  if (!_.isEmpty(checkListResponse.data.check_runs)) {
    console.log('Re-triggering Frontend Review Check');
    checkListResponse.data.check_runs[0]
    await client.checks.rerequestSuite({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      check_suite_id: checkListResponse.data.check_runs[0].check_suite.id
    })
  }
}

async function addReviewers(client: github.GitHub, prNumber: number, coreReviewers: string) {
  const pullRequestResponse = await client.pulls.get({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber
  });

  console.log(`PR author: ${pullRequestResponse.data.user.login}`);
  const reviewers = _.filter(_.split(coreReviewers, ','), reviewer => reviewer !== pullRequestResponse.data.user.login);
  console.log(`Requestung review from: ${_.join(reviewers, ', ')}`);
  client.pulls.createReviewRequest({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber,
    reviewers: reviewers,
  })
}

run();
