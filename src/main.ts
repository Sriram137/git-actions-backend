import * as core from "@actions/core";
import * as github from "@actions/github";
import * as yaml from "js-yaml";
import { Minimatch } from "minimatch";
import _ from 'lodash';

async function run() {
  try {
    const token = core.getInput('access-token', {required: true});
    const org = core.getInput('org', { required: true });
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

    core.setOutput('PROCESSING', `Fetching changed files for pr #${prNumber}`);
    const changedFiles: string[] = await getChangedFiles(client, prNumber);
    const hasChanges: boolean = hasStyleChanges(changedFiles);

    if (hasChanges) {
      core.setOutput('STATUS:', `Checking ${teamName} approval status`);
      const approvedReviewers: string[] = await getApprovedReviews(client, prNumber);
      let approvalNeeded: boolean = true;
      if (approvedReviewers.length) {
        console.log (`Pull request is approved by ${approvedReviewers.join(', ')}`);
        const reviewTeamMembers: string[] = await getReviewers(client, org, reviewTeamSlug);
        if (_.isEmpty(reviewTeamMembers)) {
          core.setFailed(`${teamName} has no members`);
          return;
        } else if (_.intersection(approvedReviewers, [...reviewTeamMembers, ..._.split(additionalReviewers, '')]).length > 0) {
          approvalNeeded = false;
        }
      }

      if (approvalNeeded) {
        core.setFailed(`${teamName} approval needed`);
      } else {
        core.setOutput(`${teamName} approved changes.`, '0');
      }
    } else {
      core.setOutput(`No approval needed from ${teamName}`, '0');
    }
  } catch (error) {
    core.error(error);
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

run();
