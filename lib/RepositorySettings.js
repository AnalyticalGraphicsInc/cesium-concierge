'use strict';

var Cesium = require('cesium');
var fs = require('fs');
var handlebars = require('handlebars');
var path = require('path');

var loadRepoConfig = require('./loadRepoConfig');

var defaultValue = Cesium.defaultValue;

var defaultStalePullRequest = fs.readFileSync(path.join(__dirname, 'templates', 'stalePullRequest.hbs')).toString();
var defaultIssueClosed = fs.readFileSync(path.join(__dirname, 'templates', 'issueClosed.hbs')).toString();
var defaultPullRequestOpened = fs.readFileSync(path.join(__dirname, 'templates', 'pullRequestOpened.hbs')).toString();
var defaultSignatureTemplate = fs.readFileSync(path.join(__dirname, 'templates', 'signature.hbs')).toString();
var defaultMaxDaysSinceUpdate = 30;

/**
 * Encapsulate available options for each repository.
 * @param {Object} [options] The repository options, see below for full details.
 * @constructor
 */
function RepositorySettings(options) {
    options = defaultValue(options, defaultValue.EMPTY_OBJECT);

    this._name = options.name;
    this._gitHubToken = options.gitHubToken;
    this._headers = {
        'User-Agent': 'cesium-concierge',
        Authorization: 'token ' + this.gitHubToken
    };

    this.thirdPartyFolders = defaultValue(options.thirdPartyFolders, []);

    this.issueClosedTemplate = defaultValue(options.issueClosedTemplate, defaultIssueClosed);
    this.pullRequestOpenedTemplate = defaultValue(options.pullRequestOpenedTemplate, defaultPullRequestOpened);
    this.stalePullRequestTemplate = defaultValue(options.stalePullRequestTemplate, defaultStalePullRequest);

    /**
     * Gets the raw template for the signature at the bottom of each comment template.
     * @type {String}
     */
    this.signatureTemplate = defaultValue(options.signatureTemplate, defaultSignatureTemplate);

    /**
     * Gets the relative path to the CONTRIBUTORS markdown file for this repository.
     */
    this.contributorsPath = options.contributorsPath;

    /**
     * Use the GitHub Contributors API
     */
    this.contributorsFromGitHub = defaultValue(options.contributorsFromGitHub, false);

    /**
     * Gets the amount of days before a pull request is considered stale.
     */
    this.maxDaysSinceUpdate = defaultValue(options.maxDaysSinceUpdate, defaultMaxDaysSinceUpdate);

    /**
     * Gets the relative path to the directory containing the unit tests.
     */
    this.unitTestPath = options.unitTestPath;

    // Exposed for testing
    this._loadRepoConfig = loadRepoConfig;
}

Object.defineProperties(RepositorySettings.prototype, {
    /**
     * Gets the name of the repository
     * @type {String}
     */
    name: {
        get: function () {
            return this._name;
        }
    },

    /**
     * Gets the headers to use for authenticated GitHub requests.
     * @type {Object}
     */
    headers: {
        get: function () {
            return this._headers;
        }
    },

    /**
     * Gets the access token for this repository.
     * @type {String}
     */
    gitHubToken: {
        get: function () {
            return this._gitHubToken;
        }
    },

    /**
     * Gets the array of third party source files.
     * @type {String[]}
     */
    thirdPartyFolders: {
        get: function () {
            return this._thirdPartyFolders;
        },
        set: function (value) {
            var thirdPartyFolders = value;
            if (typeof value === 'string') {
                var thirdPartyFoldersArray = value.split(',');
                for (var j = 0; j < thirdPartyFoldersArray.length; j++) {
                    var folder = thirdPartyFoldersArray[j];
                    if (folder.startsWith('/')) {
                        thirdPartyFoldersArray[j] = folder.slice(1);
                    }
                    if (!folder.endsWith('/')) {
                        thirdPartyFoldersArray[j] = folder + '/';
                    }
                }
                thirdPartyFolders = thirdPartyFoldersArray;
            }
            this._thirdPartyFolders = thirdPartyFolders;
        }
    },

    /**
     * Gets the handlebars template to use when commenting on a closed issue.
     * @type {String}
     */
    issueClosedTemplate: {
        get: function () {
            return handlebars.compile(this._issueClosedTemplate + this.signatureTemplate);
        },
        set: function (value) {
            this._issueClosedTemplate = value;
        }
    },

    /**
     * Gets the handlebars template to use when commenting on a new pull request.
     * @type {String}
     */
    pullRequestOpenedTemplate: {
        get: function () {
            return handlebars.compile(this._pullRequestOpenedTemplate + this.signatureTemplate);
        },
        set: function (value) {
            this._pullRequestOpenedTemplate = value;
        }
    },

    /**
     * Gets the handlebars template to use when commenting on a stale pull request for the first time.
     * @type {String}
     */
    stalePullRequestTemplate: {
        get: function () {
            return handlebars.compile(this._stalePullRequestTemplate + this.signatureTemplate);
        },
        set: function (value) {
            this._stalePullRequestTemplate = value;
        }
    }
});

/**
 * Requests the latest version of the configuration settings from the repository.
 * @returns {Promise<Object|String>} A Promise that resolves with the new configuration, or the error message if the Promise fails.
 */
RepositorySettings.prototype.fetchSettings = function () {
    return this._loadRepoConfig(this.name, this.headers, this);
};

module.exports = RepositorySettings;