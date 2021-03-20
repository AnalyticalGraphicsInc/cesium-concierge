'use strict';

var fsExtra = require('fs-extra');

var Promise = require('bluebird');
var requestPromise = require('request-promise');

var commentOnOpenedPullRequest = require('../../lib/commentOnOpenedPullRequest');
var RepositorySettings = require('../../lib/RepositorySettings');
var Settings = require('../../lib/Settings');

describe('commentOnOpenedPullRequest', function () {
    var filesUrl = 'url/files';
    var commentsUrl = 'https://api.github.com/repos/AnalyticalGraphicsInc/cesium/issues/1/comments';
    var userName = 'boomerJones';
    var repositoryName = 'AnalyticalGraphics/cesium';
    var repositoryUrl = 'https://github.com/AnalyticalGraphicsInc/cesium';
    var repositoryContributorsUrl = 'https://api.github.com/repos/AnalyticalGraphicsInc/cesium/contributors';
    var thirdPartyFolders = ['ThirdParty/', 'Source/ThirdParty/'];
    var baseBranch = 'master';
    var headBranch = 'feature';
    var headHtmlUrl = repositoryUrl;
    var headApiUrl = 'https://api.github.com/repos/AnalyticalGraphicsInc/cesium';

    var pullRequestJson = {
        pull_request: {
            url: 'url',
            comments_url: commentsUrl,
            user: {
                login: userName
            },
            head: {
                ref: 'feature',
                repo: {
                    url: headApiUrl,
                    html_url: headHtmlUrl
                }
            },
            base: {
                ref: 'master'
            }
        },
        repository: {
            html_url: repositoryUrl,
            contributors_url: repositoryContributorsUrl,
            full_name: repositoryName
        }
    };

    var googleSheetsIndividualResponse = {
        data : {
            values : [
                ['boomerJones'],
                []//The spreadsheet may have an empty row
            ]
        }
    };

    var googleSheetsCorporateResponse = {
        data : {
            values : [
                [],
                ['Boomer Jones - boomerJones\nOmar Shehata - OmarShehata']
            ]
        }
    };

    beforeEach(function () {
        spyOnProperty(Settings, 'individualClaSheetID').and.returnValue('individual');
        spyOnProperty(Settings, 'corporateClaSheetID').and.returnValue('corporate');

        Settings.googleSheetsApi = {
            spreadsheets : {
                values : {
                    get : function(options) {
                        if (options.spreadsheetId === 'individual') {
                            return Promise.resolve(googleSheetsIndividualResponse);
                        } else if (options.spreadsheetId === 'corporate') {
                            return Promise.resolve(googleSheetsCorporateResponse);
                        }

                        return Promise.reject('Invalid sheet ID.');
                    }
                }
            }
        };
    });

    afterEach(function () {
        delete Settings['googleSheetsApi'];
    });

    it('throws if body is undefined', function () {
        expect(function () {
            commentOnOpenedPullRequest(undefined, {});
        }).toThrowError();
    });

    it('throws if headers is undefined', function () {
        expect(function () {
            commentOnOpenedPullRequest(pullRequestJson, undefined);
        }).toThrowError();
    });

    it('throws if json is not a pull request event', function () {
        var issueJson = fsExtra.readJsonSync('./specs/data/events/issue.json');
        expect(function () {
            commentOnOpenedPullRequest(issueJson, {});
        }).toThrowError();
    });

    it('passes expected parameters to implementation', function () {
        spyOn(commentOnOpenedPullRequest, '_implementation');

        var repositorySettings = new RepositorySettings();

        commentOnOpenedPullRequest(pullRequestJson, repositorySettings);

        expect(commentOnOpenedPullRequest._implementation).toHaveBeenCalledWith(filesUrl, commentsUrl, repositorySettings, userName, repositoryUrl, baseBranch, headBranch, headHtmlUrl, headApiUrl, repositoryContributorsUrl);
    });

    it('commentOnOpenedPullRequest._askAboutChanges works', function () {
        expect(commentOnOpenedPullRequest._askAboutChanges(['CHANGES.md'],'master')).toBe(false);
        expect(commentOnOpenedPullRequest._askAboutChanges(['file.txt'],'feature-branch')).toBe(false);

        expect(commentOnOpenedPullRequest._askAboutChanges([],'master')).toBe(true);
        expect(commentOnOpenedPullRequest._askAboutChanges(['file.txt'],'master')).toBe(true);
        expect(commentOnOpenedPullRequest._askAboutChanges(['CHANGES.MD'],'master')).toBe(true);
        expect(commentOnOpenedPullRequest._askAboutChanges(['leadingCHANGES.md'],'master')).toBe(true);
        expect(commentOnOpenedPullRequest._askAboutChanges(['CHANGES.mdtrailing'],'master')).toBe(true);
    });

    it('commentOnOpenedPullRequest._askAboutTests works', function () {
        expect(commentOnOpenedPullRequest._askAboutTests(['file.txt'])).toBe(false);
        expect(commentOnOpenedPullRequest._askAboutTests(['Specs/lib/testSpec.js'])).toBe(false);
        expect(commentOnOpenedPullRequest._askAboutTests(['Specs/lib/testSpec.js'], 'Specs/')).toBe(false);
        expect(commentOnOpenedPullRequest._askAboutTests(['specs/lib/testSpec.js'], 'Specs/')).toBe(false);

        expect(commentOnOpenedPullRequest._askAboutTests(['file.txt'], 'Specs/')).toBe(true);
    });

    it('commentOnOpenedPullRequest._askAboutThirdParty works', function () {
        expect(commentOnOpenedPullRequest._askAboutThirdParty(['ThirdParty/file.js'], ['ThirdParty'])).toBe(true);

        expect(commentOnOpenedPullRequest._askAboutThirdParty(['file.txt'], [])).toBe(false);
        expect(commentOnOpenedPullRequest._askAboutThirdParty(['file.txt'], undefined)).toBe(false);
        expect(commentOnOpenedPullRequest._askAboutThirdParty(['NotThirdParty/file.js'], ['ThirdParty'])).toBe(false);
    });

    it('commentOnOpenedPullRequest._implementation fetches latest repository settings.', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';

        var repositorySettings = new RepositorySettings();

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'CHANGES.md'}
                ]);
            }
            return Promise.reject('Unknown url.');
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl)
            .then(function () {
                expect(repositorySettings.fetchSettings).toHaveBeenCalled();
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation posts CLA confirmation if CHANGES.md was updated and there are no modified ThirdParty folders or CLA', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';

        var repositorySettings = new RepositorySettings();

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'CHANGES.md'}
                ]);
            }
            return Promise.reject('Unknown url.');
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: false,
                            askAboutChanges: false,
                            askAboutThirdParty: false,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._askForCla catches and reports errors with Google Sheets API', function () {
        var errorText = 'Google Sheets API failed.';

        spyOn(Settings.googleSheetsApi.spreadsheets.values, 'get').and.callFake(function () {
            return Promise.reject(errorText);
        });

        return commentOnOpenedPullRequest._askForCla(userName)
            .then(function() {
                fail('expected promise to reject.');
            })
            .catch(function(error) {
                expect(error).toBe(errorText);
            });
    });

    it('commentOnOpenedPullRequest._implementation catches and reports errors processing CLA check', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';
        var errorCla = new Error('Error checking CLA.');
        var repositorySettings = new RepositorySettings();

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'CHANGES.md'}
                ]);
            }

            return Promise.reject('Unknown url.');
        });

        spyOn(commentOnOpenedPullRequest, '_askForCla').and.callFake(function () {
            return Promise.reject(errorCla);
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: false,
                            errorCla: errorCla.toString(),
                            askAboutChanges: false,
                            askAboutThirdParty: false,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation posts if CHANGES.md was not updated and there are no modified ThirdParty folders or CLA', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';

        var repositorySettings = new RepositorySettings({
            thirdPartyFolders: thirdPartyFolders.join(',')
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'notCHANGES.md'}
                ]);
            }
            return Promise.reject('Unknown url.');
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl, baseBranch, headBranch)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: false,
                            askAboutChanges: true,
                            askAboutThirdParty: false,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation does not post when the target branch is not master', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';

        var repositorySettings = new RepositorySettings({
            thirdPartyFolders: thirdPartyFolders.join(',')
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'notCHANGES.md'}
                ]);
            }
            return Promise.reject('Unknown url.');
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl, 'feature-branch')
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: false,
                            askAboutChanges: false,
                            askAboutThirdParty: false,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation posts if CHANGES.md was updated but there are modified ThirdParty folders', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';

        var repositorySettings = new RepositorySettings({
            thirdPartyFolders: thirdPartyFolders.join(',')
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'CHANGES.md'},
                    {filename: 'ThirdParty/stuff.js'}
                ]);
            }
            return Promise.reject('Unknown url.');
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: false,
                            askAboutChanges: false,
                            askAboutThirdParty: true,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation posts if CHANGES.md was not updated and there are modified ThirdParty folders', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';

        var repositorySettings = new RepositorySettings({
            thirdPartyFolders: thirdPartyFolders.join(',')
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'ThirdParty/stuff.js'}
                ]);
            }
            return Promise.reject('Unknown url.');
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl, baseBranch, headBranch)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: false,
                            askAboutChanges: true,
                            askAboutThirdParty: true,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation posts if CHANGES.md was not updated and there are modified ThirdParty folders, and CLA check succeeded.', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';
        var claUrl = 'cla.json';

        var repositorySettings = new RepositorySettings({
            thirdPartyFolders: thirdPartyFolders.join(','),
            claUrl: claUrl
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'ThirdParty/stuff.js'}
                ]);
            }
            if (options.url === claUrl) {
                var content = Buffer.from(JSON.stringify([{gitHub: userName}])).toString('base64');
                return Promise.resolve({
                    content: content
                });
            }
            return Promise.reject('Unknown url.');
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl, baseBranch, headBranch)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: false,
                            askAboutChanges: true,
                            askAboutThirdParty: true,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation posts if CHANGES.md was not updated and there are modified ThirdParty folders, and CLA check failed.', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';
        var newContributor = 'newContributor';

        var repositorySettings = new RepositorySettings({
            thirdPartyFolders: thirdPartyFolders.join(',')
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'ThirdParty/stuff.js'}
                ]);
            }

            return Promise.reject('Unknown url.');
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, newContributor, repositoryUrl, baseBranch, headBranch)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: newContributor,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: true,
                            askAboutChanges: true,
                            askAboutThirdParty: true,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation reminds user to add to CONTRIBUTORS.md.', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';
        var contributorsPath = 'CONTRIBUTORS.md';
        var apiUrl = headApiUrl + '/contents/' + contributorsPath + '?ref=' + headBranch;
        var htmlUrl =  headHtmlUrl + '/blob/' + headBranch + '/' + contributorsPath;
        var newContributor = 'newContributor';

        var repositorySettings = new RepositorySettings({
            contributorsPath: contributorsPath,
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'file.txt'}
                ]);
            }

            if (options.url === apiUrl) {
                var content = Buffer.from('* [Jane Doe](https://github.com/JaneDoe)\n* [Boomer Jones](https://github.com/' + userName + ')').toString('base64');
                return Promise.resolve({
                    content: content
                });
            }

            return Promise.reject('Unknown url: ' + options.url);
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, newContributor, repositoryUrl, baseBranch, headBranch, headHtmlUrl, headApiUrl, repositoryContributorsUrl)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: newContributor,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: true,
                            askAboutContributors: true,
                            contributorsUrl: htmlUrl,
                            askAboutChanges: true,
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation reminds informs about first time user using GitHub Contributors', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';
        var newContributor = 'newContributor';

        var repositorySettings = new RepositorySettings({
            contributorsFromGitHub: true
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'file.txt'}
                ]);
            }

            if (options.url === repositoryContributorsUrl) {
                return Promise.resolve([]);
            }

            return Promise.reject('Unknown url: ' + options.url);
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, newContributor, repositoryUrl, baseBranch, headBranch, headHtmlUrl, headApiUrl, repositoryContributorsUrl)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: newContributor,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askForCla: true,
                            askAboutContributors: true,
                            askAboutChanges: true,
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation does not post reminder about CONTRIBUTORS.md if user is already in there.', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';
        var contributorsPath = 'CONTRIBUTORS.md';
        var apiUrl = headApiUrl + '/contents/' + contributorsPath + '?ref=' + headBranch;

        var repositorySettings = new RepositorySettings({
            contributorsPath: contributorsPath
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'file.txt'}
                ]);
            }

            if (options.url === apiUrl) {
                var content = Buffer.from('* [Jane Doe](https://github.com/JaneDoe)\n* [Boomer Jones](https://github.com/' + userName + ')').toString('base64');
                return Promise.resolve({
                    content: content
                });
            }
            return Promise.reject('Unknown url: ' + options.url);
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl, baseBranch, headBranch, headHtmlUrl, headApiUrl, repositoryContributorsUrl)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askAboutContributors: false,
                            askAboutChanges: true,
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('commentOnOpenedPullRequest._implementation does not remind existing contributor using GitHub Contributors', function (done) {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';

        var repositorySettings = new RepositorySettings({
            contributorsFromGitHub: true
        });

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'file.txt'}
                ]);
            }

            if (options.url === repositoryContributorsUrl) {
                return Promise.resolve([{
                    login: userName
                }]);
            }

            return Promise.reject('Unknown url: ' + options.url);
        });

        commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl, baseBranch, headBranch, headHtmlUrl, headApiUrl, repositoryContributorsUrl)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: true,
                            askAboutContributors: false,
                            askAboutChanges: true,
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
                done();
            })
            .catch(done.fail);
    });

    it('works when Google Sheets API is not configured', function () {
        var pullRequestFilesUrl = 'pullRequestFilesUrl';
        var pullRequestCommentsUrl = 'pullRequestCommentsUrl';

        Settings.googleSheetsApi = undefined;

        var repositorySettings = new RepositorySettings();

        spyOn(repositorySettings, 'fetchSettings').and.callFake(function() {
            return Promise.resolve(repositorySettings);
        });

        spyOn(requestPromise, 'post');

        spyOn(requestPromise, 'get').and.callFake(function (options) {
            if (options.url === pullRequestFilesUrl) {
                return Promise.resolve([
                    {filename: 'CHANGES.md'}
                ]);
            }
            return Promise.reject('Unknown url.');
        });

        return commentOnOpenedPullRequest._implementation(pullRequestFilesUrl, pullRequestCommentsUrl, repositorySettings, userName, repositoryUrl)
            .then(function () {
                expect(requestPromise.post).toHaveBeenCalledWith({
                    url: pullRequestCommentsUrl,
                    headers: repositorySettings.headers,
                    body: {
                        body: repositorySettings.pullRequestOpenedTemplate({
                            userName: userName,
                            repository_url: repositoryUrl,
                            claEnabled: false,
                            askAboutChanges: false,
                            askAboutThirdParty: false,
                            thirdPartyFolders: thirdPartyFolders.join(', '),
                            headBranch: headBranch
                        })
                    },
                    json: true
                });
            });
        });
});
