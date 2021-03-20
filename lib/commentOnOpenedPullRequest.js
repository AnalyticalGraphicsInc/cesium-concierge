'use strict';
var Cesium = require('cesium');
var Promise = require('bluebird');
var requestPromise = require('request-promise');

var Settings = require('./Settings');

var Check = Cesium.Check;
var defined = Cesium.defined;

module.exports = commentOnOpenedPullRequest;

/**
 * Comments on a newly opened pull request.
 *
 * @param {Object} body The GitHub event body.
 * @param {Object} repositorySettings Headers to use for making additional GitHub requests.
 * @returns {Promise} A Promise that resolves when processing is complete.
 */
function commentOnOpenedPullRequest(body, repositorySettings) {
    Check.typeOf.object('body', body);
    Check.typeOf.object('repositorySettings', repositorySettings);

    var pullRequest = body.pull_request;
    var filesUrl = pullRequest.url + '/files';
    var commentsUrl = pullRequest.comments_url;
    var userName = pullRequest.user.login;
    var baseBranch = pullRequest.base.ref;
    var headBranch = pullRequest.head.ref;
    var headHtmlUrl = pullRequest.head.repo.html_url;
    var headApiUrl = pullRequest.head.repo.url;

    var repository = body.repository;
    var repositoryUrl = repository.html_url;
    var repositoryContributorsUrl = repository.contributors_url;

    return commentOnOpenedPullRequest._implementation(filesUrl, commentsUrl, repositorySettings, userName, repositoryUrl, baseBranch, headBranch, headHtmlUrl, headApiUrl, repositoryContributorsUrl);
}

commentOnOpenedPullRequest._implementation = function (pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl, baseBranch, headBranch, headHtmlUrl, headApiUrl, repositoryContributorsUrl) {
    // The google sheets API will fail to initialize if any of the required settings are missing.
    var claEnabled = defined(Settings.googleSheetsApi);
    var askForCla = false;
    var askAboutContributors = false;
    var errorCla;
    return repositorySettings.fetchSettings()
        .then(function () {
            return commentOnOpenedPullRequest._askForCla(userName);
        })
        .then(function (result) {
            askForCla = result;
        })
        .catch(function(error) {
            errorCla = error.toString();
        })
        .then(function () {
            return commentOnOpenedPullRequest._askAboutContributors(userName, repositorySettings, headApiUrl, headBranch, repositoryContributorsUrl);
        })
        .then(function (result) {
            askAboutContributors = result;
        })
        .then(function () {
            return requestPromise.get({
                url: pullRequestFilesUrl,
                headers: repositorySettings.headers,
                json: true
            });
        })
        .then(function (filesJsonResponse) {
            var files = filesJsonResponse.map(function (file) {
                return file.filename;
            });

            var askAboutChanges = commentOnOpenedPullRequest._askAboutChanges(files, baseBranch);
            var askAboutThirdParty = commentOnOpenedPullRequest._askAboutThirdParty(files, repositorySettings.thirdPartyFolders);
            var askAboutTests = commentOnOpenedPullRequest._askAboutTests(files, repositorySettings.unitTestPath);
            var contributorsUrl;
            if (defined(repositorySettings.contributorsPath)) {
                contributorsUrl = headHtmlUrl + '/blob/' + headBranch + '/' + repositorySettings.contributorsPath;
            }

            var message = repositorySettings.pullRequestOpenedTemplate({
                userName: userName,
                repository_url: repositoryUrl,
                claEnabled: claEnabled,
                askForCla: askForCla,
                errorCla: errorCla,
                askAboutChanges: askAboutChanges,
                askAboutContributors: askAboutContributors,
                contributorsUrl: contributorsUrl,
                askAboutThirdParty: askAboutThirdParty,
                thirdPartyFolders: repositorySettings.thirdPartyFolders.join(', '),
                headBranch: headBranch,
                askAboutTests: askAboutTests
            });

            return requestPromise.post({
                url: pullRequestCommentsUrl,
                headers: repositorySettings.headers,
                body: {
                    body: message
                },
                json: true
            });
        });
};

commentOnOpenedPullRequest._askAboutChanges = function (files, baseBranch) {
    if (baseBranch !== 'master') {
        return false;
    }
    for (var i = 0; i < files.length; i++) {
        if (/^CHANGES\.md$/.test(files[i])) {
            return false;
        }
    }
    return true;
};

commentOnOpenedPullRequest._askAboutContributors = function (userName, repositorySettings, headApiUrl, headBranch, repositoryContributorsUrl) {
    if (!defined(repositorySettings.contributorsPath) && !repositorySettings.contributorsFromGitHub) {
        return Promise.resolve(false);
    }

    if (repositorySettings.contributorsFromGitHub) {
        var contributorsPromises = [];
        for (var i = 1; i < 6; i++) { // GitHub maintains only 500 named contributors
            contributorsPromises[i - 1] = requestPromise.get({
                url: repositoryContributorsUrl,
                qs: {
                    per_page: 100,
                    page: i
                },
                headers: repositorySettings.headers,
                json: true
            });
        }

        return Promise.all(contributorsPromises)
        .then(function (responses) {
            var fullContributorsList = [].concat.apply([], responses);
            var result = fullContributorsList.find(function(contributor) {
                return contributor.login === userName;
            });
            return !defined(result);
        });
    }

    var url = headApiUrl + '/contents/' + repositorySettings.contributorsPath + '?ref=' + headBranch;

    return requestPromise.get({
        url: url,
        headers: repositorySettings.headers,
        json: true
    })
    .then(function (response) {
        var contributorsFileContent = Buffer.from(response.content, 'base64').toString();
        return contributorsFileContent.indexOf(userName) === -1;
    });
};

commentOnOpenedPullRequest._askAboutThirdParty = function (files, thirdPartyFolders) {
    if (!defined(thirdPartyFolders) || thirdPartyFolders.length === 0) {
        return false;
    }
    for (var i = 0; i < files.length; i++) {
        for (var j = 0; j < thirdPartyFolders.length; j++) {
            var folder = thirdPartyFolders[j];
            if (files[i].startsWith(folder)) {
                return true;
            }
        }
    }
    return false;
};

commentOnOpenedPullRequest._askAboutTests = function (files, unitTestPath) {
    if (!defined(unitTestPath)) {
        return false;
    }
    for (var i = 0; i < files.length; i++) {
        var regex = new RegExp('^' + unitTestPath, 'i');
        if (regex.test(files[i])) {
            return false;
        }
    }
    return true;
};

commentOnOpenedPullRequest._askForCla = function (userName) {
    if (!defined(Settings.googleSheetsApi)) {
        return Promise.resolve(false);
    }

    var foundIndividualCLA = false;
    var foundCorporateCLA = false;
    // Check individual CLA sheet.
    return Settings.googleSheetsApi.spreadsheets.values.get({
        spreadsheetId: Settings.individualClaSheetID,
        range: 'D2:D'
    })
    .then(function(response) {
        var rows = response.data.values;

        for (var i = 0; i < rows.length; i++) {
            if(rows[i].length === 0) {
                continue;
            }
            var rowUserName = rows[i][0].toLowerCase();
            if (userName.toLowerCase() === rowUserName) {
                foundIndividualCLA = true;
                break;
            }
        }

        // Now check corporate CLA sheet.
        return Settings.googleSheetsApi.spreadsheets.values.get({
            spreadsheetId: Settings.corporateClaSheetID,
            range: 'H2:H'
        });
    })
    .then(function(response) {
        var rows = response.data.values;
        for (var i = 0; i < rows.length; i++) {
            if(rows[i].length === 0) {
                continue;
            }
            var rowScheduleA = rows[i][0].toLowerCase();
            // We're a little more lenient with the ScheduleA userName check, since it's an unformatted text field.
            // We split the ScheduleA field by whitespace see if we can find the GitHub username in there.
            rowScheduleA = rowScheduleA.replace(/\n/g, ' ');
            var words = rowScheduleA.split(' ');
            for (var j = 0; j < words.length; j++) {
                if (userName.toLowerCase() === words[j].trim()) {
                    foundCorporateCLA = true;
                    break;
                }
            }
        }

        return !foundIndividualCLA && !foundCorporateCLA;
    });
};
