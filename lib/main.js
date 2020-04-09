"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const lodash_1 = __importDefault(require("lodash"));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const token = core.getInput('access-token', { required: true });
            const org = core.getInput('org', { required: true });
            const teamName = core.getInput('teamName', {required: true});
            const coreReviewers = core.getInput('core-reviewers');
            const additionalReviewers = core.getInput('additional-reviewers');
            const fileNameMatch = core.getInput('fileNameMatch', {required: true});
            const needReviewOnLatestCommit = (core.getInput('needReviewOnLatestCommit')) !== 'false';
            const reviewTeamSlug = core.getInput('review-team-slug');
            if (!token || !org ) {
                core.debug('Please provide access-token, org and review-team-slug');
                return;
            }
            const client = new github.GitHub(token);
            console.log(`EVENT: ${github.context.eventName}`);
            if (github.context.eventName === 'push') {
                yield handlePushEvent(client, teamName, coreReviewers, additionalReviewers, reviewTeamSlug, fileNameMatch, needReviewOnLatestCommit);
                return;
            }
            if (github.context.eventName === 'pull_request_review') {
                yield reTriggerFrontendCheck(client);
                return;
            }
            console.log('ERROR: Event not handled');
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
function getReviewers(client, reviewTeamSlug) {
    return __awaiter(this, void 0, void 0, function* () {
        if(!reviewTeamSlug){
            return [];
        }
        const team = yield client.teams.getByName({
            org: github.context.repo.owner,
            team_slug: reviewTeamSlug,
        });
        if (!team) {
            return [];
        }
        const teamId = team.data.id;
        const members = yield client.teams.listMembers({
            team_id: teamId,
        });
        return lodash_1.default.map(members.data, 'login');
    });
}
function getChangedFiles(client, prNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        const listFilesResponse = yield client.pulls.listFiles({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: prNumber
        });
        const changedFiles = listFilesResponse.data.map(f => f.filename);
        return changedFiles;
    });
}
function hasReviewableChanges(changedFiles, fileNameMatch) {
    if (lodash_1.default.isEmpty(changedFiles)) {
        return false;
    }
    return lodash_1.default.some(changedFiles, fileName => lodash_1.default.includes(fileName, fileNameMatch));
}
function addReviewers(client, prNumber, coreReviewers) {
    return __awaiter(this, void 0, void 0, function* () {
        const pullRequestResponse = yield client.pulls.get({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: prNumber
        });
        console.log(`PR author: ${pullRequestResponse.data.user.login}`);
        const reviewers = lodash_1.default.filter(lodash_1.default.split(coreReviewers, ','), reviewer => reviewer !== pullRequestResponse.data.user.login);
        console.log(`Requesting review from: ${lodash_1.default.join(reviewers, ', ')}`);
        client.pulls.createReviewRequest({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: prNumber,
            reviewers: reviewers,
        });
    });
}
// Re trigger event
function reTriggerFrontendCheck(client) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('LOG: Finding Frontend Review Check');
        const pullRequest = github.context.payload.pull_request;
        if (pullRequest) {
            const headSHA = yield getPullRequestHeadSHA(client, pullRequest.number);
            console.log(`LOG: Finding checks for PR: ${headSHA}`);
            const checkListResponse = yield client.checks.listForRef({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                ref: headSHA,
            });
            console.log(`LOG: Found ${checkListResponse.data.check_runs.length} check runs.`);
            const reviewCheck = lodash_1.default.find(checkListResponse.data.check_runs, { name: 'FrontendReviewStatus' });
            if (reviewCheck) {
                console.log(`LOG: Re-triggering Review Check ${reviewCheck.name}`);
                yield client.checks.rerequestSuite({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    check_suite_id: reviewCheck.check_suite.id
                });
            }
            else {
                console.log(checkListResponse.data.check_runs);
                core.setFailed('ERROR: No matching check found.');
            }
        }
        else {
            core.setFailed('ERROR: Pull request not found.');
        }
    });
}
function getPullRequestHeadSHA(client, pull_number) {
    return __awaiter(this, void 0, void 0, function* () {
        const pullRequestResponse = yield client.pulls.get({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number
        });
        return pullRequestResponse.data.head.sha;
    });
}
// PUSH EVENT HANDLING
function handlePushEvent(client, teamName, coreReviewers, additionalReviewers, reviewTeamSlug, fileNameMatch, needReviewOnLatestCommit) {
    return __awaiter(this, void 0, void 0, function* () {
        const pullRequest = yield getPullRequestForSHA(client, github.context.sha);
        if (!pullRequest) {
            console.log('ERROR: Pull request not found.');
            return;
        }
        console.log(`PROCESSING: Fetching changed files for PR:#${pullRequest.number}`);
        const changedFiles = yield getChangedFiles(client, pullRequest.number);
        const hasChanges = hasReviewableChanges(changedFiles, fileNameMatch);
        if (hasChanges) {
            const isApproved = yield checkApprovalForSHA(client, pullRequest.number, github.context.sha, additionalReviewers, reviewTeamSlug, needReviewOnLatestCommit);
            if (isApproved) {
                console.log(`SUCCESS: ${teamName} approved changes.`);
            }
            else {
                yield addReviewers(client, pullRequest.number, coreReviewers);
                core.setFailed(`ERROR: ${teamName} approval needed for ${fileNameMatch}`);
            }
        }
        else {
            console.log(`SUCCESS: No approval needed from ${teamName}.}`);
        }
    });
}
function getPullRequestForSHA(client, commit_sha) {
    return __awaiter(this, void 0, void 0, function* () {
        const pullRequests = yield listPullRequestsAssociatedWithCommit(client, github.context.sha);
        const openPullRequests = lodash_1.default.filter(pullRequests, { state: 'open' });
        if (lodash_1.default.size(openPullRequests) > 1) {
            console.log(`WARNING: Multiple pull requests found for SHA: ${github.context.sha}.`);
        }
        return openPullRequests[0];
    });
}
function listPullRequestsAssociatedWithCommit(client, commit_sha) {
    return __awaiter(this, void 0, void 0, function* () {
        const apiResponse = yield client.repos.listPullRequestsAssociatedWithCommit({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            commit_sha
        });
        return apiResponse.data;
    });
}
function checkApprovalForSHA(client, pull_number, commit_sha, additionalReviewers, reviewTeamSlug, needReviewOnLatestCommit) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('STATUS: Checking approval status');
        const approvedLogins = yield getApprovedReviewsForSHA(client, pull_number, commit_sha, needReviewOnLatestCommit);
        console.log('approved logins');
        console.log(approvedLogins);
        const reviewTeamMembers = yield getReviewers(client, reviewTeamSlug);
        if (lodash_1.default.intersection(approvedLogins, [...reviewTeamMembers, ...lodash_1.default.split(additionalReviewers, ',')]).length > 0) {
            return true;
        }
        return false;
    });
}
function getApprovedReviewsForSHA(client, pull_number, commit_sha, needReviewOnLatestCommit) {
    return __awaiter(this, void 0, void 0, function* () {
        const apiResponse = yield client.pulls.listReviews({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number
        });

        const filterDict = {
            state: 'APPROVED',
        };
        const commitDict = needReviewOnLatestCommit ? {commit_id: commit_sha} : {};

        const finalDict = Object.assign(filterDict, commitDict);

        return lodash_1.default(apiResponse.data)
            .filter(finalDict)
            .map('user.login')
            .value();
    });
}
run();
