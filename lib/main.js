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
            const teamName = `${lodash_1.default.capitalize(reviewTeamSlug)}-Team`;
            const client = new github.GitHub(token);
            if (github.context.eventName === 'pull_request_review') {
                yield reRunFrontendCheck(client);
                return;
            }
            console.log(`PROCESSING: Fetching changed files for pr #${prNumber}`);
            const changedFiles = yield getChangedFiles(client, prNumber);
            const hasChanges = hasStyleChanges(changedFiles);
            if (hasChanges) {
                console.log(`STATUS: Checking ${teamName} approval status`);
                const approvedReviewers = yield getApprovedReviews(client, prNumber);
                let approvalNeeded = true;
                if (approvedReviewers.length) {
                    console.log(`Pull request is approved by ${approvedReviewers.join(', ')}`);
                    const reviewTeamMembers = yield getReviewers(client, org, reviewTeamSlug);
                    if (lodash_1.default.isEmpty(reviewTeamMembers)) {
                        core.setFailed(`${teamName} has no members`);
                        return;
                    }
                    else if (lodash_1.default.intersection(approvedReviewers, [...reviewTeamMembers, ...lodash_1.default.split(additionalReviewers, '')]).length > 0) {
                        approvalNeeded = false;
                    }
                }
                if (approvalNeeded) {
                    yield addReviewers(client, prNumber, coreReviewers);
                    core.setFailed(`${teamName} approval needed`);
                }
                else {
                    console.log(`${teamName} approved changes.`);
                }
            }
            else {
                console.log(`No approval needed from ${teamName}`);
            }
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
function getReviewers(client, org, reviewTeamSlug) {
    return __awaiter(this, void 0, void 0, function* () {
        const team = yield client.teams.getByName({
            org,
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
function getApprovedReviews(client, prNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        const listReviewRequests = yield client.pulls.listReviews({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: prNumber,
        });
        return lodash_1.default(listReviewRequests.data)
            .filter({ state: 'APPROVED' })
            .map('user.login')
            .uniq()
            .value();
    });
}
function getPrNumber() {
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
function hasStyleChanges(changedFiles) {
    if (lodash_1.default.isEmpty(changedFiles)) {
        return false;
    }
    return lodash_1.default.some(changedFiles, fileName => lodash_1.default.includes(fileName, 'app/modules/Common'));
    // return _.some(changedFiles, fileName => (
    //   _.endsWith(fileName, '.scss')
    //   || _.endsWith(fileName, '.css')
    //   || _.includes(fileName, 'app/modules/Common')
    // ));
}
function reRunFrontendCheck(client) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Finding Frontend Review Check');
        const checkListResponse = yield client.checks.listForRef({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            ref: github.context.sha,
            check_name: 'FrontendReviewCheck',
        });
        if (!lodash_1.default.isEmpty(checkListResponse.data.check_runs)) {
            console.log('Re-triggering Frontend Review Check');
            checkListResponse.data.check_runs[0];
            yield client.checks.rerequestSuite({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                check_suite_id: checkListResponse.data.check_runs[0].check_suite.id
            });
        }
        else {
            console.log('No Check Found');
            console.log(checkListResponse.data);
        }
    });
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
        console.log(`Requestung review from: ${lodash_1.default.join(reviewers, ', ')}`);
        client.pulls.createReviewRequest({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: prNumber,
            reviewers: reviewers,
        });
    });
}
run();
