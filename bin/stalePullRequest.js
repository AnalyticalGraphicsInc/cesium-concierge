'use strict';

var Promise = require('bluebird');
var requestPromise = require('request-promise');
var parseLink = require('parse-link-header');

var Settings = require('../lib/Settings');
var dateLog = require('../lib/dateLog');

module.exports = stalePullRequest;

if (require.main === module) {
    Settings.loadRepositoriesSettings('./config.json')
        .then(function () {
            return stalePullRequest(Settings.repositories);
        })
        .catch(function (err) {
            console.error(err);
        });
}

/**
 * Bumps stale pull requests for all configured repositories.
 *
 * @param {Object} repositories The Settings.repositories object.
 * @returns {Promise} A promise that resolves when the process is complete.
 */
function stalePullRequest(repositories) {
    dateLog('Initiating `stalePullRequest` job.');
    return Promise.each(Object.keys(repositories), function (repositoryName) {
        var repositorySettings = repositories[repositoryName];
        return stalePullRequest._processRepository(repositoryName, repositorySettings)
            .catch(function (error) {
                //Eat the error here so that all repositories are processed.
                console.error(error);
            });
    });
}

/**
 * Implementation
 *
 * @param {String} repositoryName Base url to list pull requests https://developer.github.com/v3/pulls/#list-pull-requests
 * @param {RepositorySettings} repositorySettings The repository settings
 * @return {Promise<Array<http.IncomingMessage | undefined>>} Promise to an array of incoming messages
 */
stalePullRequest._processRepository = function (repositoryName, repositorySettings) {
    dateLog('Checking ' + repositoryName);
    return requestPromise.get({
        url: 'https://api.github.com/repos/' + repositoryName + '/pulls?state=open&base=master',
        headers: repositorySettings.headers,
        json: true
    })
        .then(function (pullRequestsJsonResponse) {
            return Promise.each(pullRequestsJsonResponse, function (pullRequest) {
                return stalePullRequest._processPullRequest(pullRequest, repositorySettings);
            });
        });
};

stalePullRequest._processPullRequest = function (pullRequest, repositorySettings) {
    var commentsUrl = pullRequest.comments_url;
    return requestPromise.get({
        url: commentsUrl,
        headers: repositorySettings.headers,
        json: true,
        resolveWithFullResponse: true
    })
        .then(function (response) {
            var lastPage = parseLink(response.headers.link).last.page;
            return requestPromise.get({
                url: commentsUrl + '?page=' + lastPage,
                headers: repositorySettings.headers,
                json: true,
            }).then(function (commentsJsonResponse) {
                var lastComment = commentsJsonResponse[commentsJsonResponse.length - 1];
                var foundStop = stalePullRequest.foundStopComment(commentsJsonResponse);
                if (!foundStop && stalePullRequest.daysSince(new Date(lastComment.created_at)) >= repositorySettings.maxDaysSinceUpdate) {
                    var template = repositorySettings.stalePullRequestTemplate;
                    return requestPromise.post({
                        url: commentsUrl,
                        headers: repositorySettings.headers,
                        body: {
                            body: template({
                                maxDaysSinceUpdate: repositorySettings.maxDaysSinceUpdate
                            })
                        },
                        json: true
                    });
                }
            });
        });
};

stalePullRequest.daysSince = function (date) {
    var msPerDay = 24 * 60 * 60 * 1000;
    return (Date.now() - date.getTime()) / msPerDay;
};

stalePullRequest.foundStopComment = function (commentsJsonResponse) {
    for(var i = 0; i < commentsJsonResponse.length; i++){
        var comment = commentsJsonResponse[i].body.toLowerCase();
        var userName = commentsJsonResponse[i].user.login;
        if (userName !== 'cesium-concierge' && comment.indexOf('@cesium-concierge stop') !== -1) {
            return true;
        }
    }

    return false;
};