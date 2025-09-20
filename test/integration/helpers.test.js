/**
 * Integration tests for the helpers module.
 */
import { expect } from 'chai';
import sinon from 'sinon';
import { afterCLA } from '../../src/helpers.js';
import GitHub from '../../src/services/GitHub.js';

describe('afterCLA', function() {
  let claSignatureInfo, removeLabelStub;

  beforeEach(function() {
    removeLabelStub = sinon.stub();
    GitHub.app = {
      octokit: {
        rest: {
          search: {
            issuesAndPullRequests: sinon.stub()
          },
          issues: {
            removeLabel: removeLabelStub
          }
        }
      },
      eachInstallation: {
        iterator: sinon.stub().returns([{ installation: { id: 1, account: { login: 'test-org' } } }])
      },
      eachRepository: {
        iterator: sinon.stub().returns([{ octokit: { rest: { issues: { removeLabel: removeLabelStub } } }, repository: { owner: { login: 'test-org' }, name: 'test-repo' } }])
      }
    };

    GitHub.getOctokitForOrg = sinon.stub().resolves(GitHub.app.octokit);

    claSignatureInfo = {
      referrer: 'https://website.com/cla?org=test-org&repo=test-repo&prNumber=1234&username=test-user',
      username: 'test-user'
    };
  });

  afterEach(function() {
    sinon.restore();
  });

  it('should process CLA and remove "Pending CLA" label from PRs', async function() {
    // Mock the response from search.issuesAndPullRequests
    // Docs for octokit.rest.search.issuesAndPullRequests - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/search/issuesAndPullRequests.md
    GitHub.app.octokit.rest.search.issuesAndPullRequests.resolves({
      data: {
        items: [
          {
            number: 1234,
            user: { login: 'test-user' },
            repository: { name: 'test-repo' },
            labels: [{ name: 'Pending CLA' }]
          },
          {
            number: 1235,
            user: { login: 'test-user' },
            repository: { name: 'test-repo-2' },
            labels: [{ name: 'Pending CLA' }]
          },
          {
            number: 1236,
            user: { login: 'test-user' },
            repository: {},
            labels: [{ name: 'Pending CLA' }]
          },
          {
            number: 1237,
            user: { login: 'test-user-2' },
            labels: [{ name: 'Pending CLA' }]
          },
          {
            number: 1234,
            user: { login: 'test-user' },
            repository: { name: 'test-repo' },
            labels: [{ name: 'some-other-label' }]
          }
        ]
      }
    });

    // Call the afterCLA function
    await afterCLA(claSignatureInfo);

    // Verify that removeLabel was called for all 3 PRs by test-user with label "Pending CLA"
    expect(removeLabelStub.callCount).to.be.equal(3);
    // test-user PR 1234
    expect(removeLabelStub.args[0][0]).to.include({
      issue_number: 1234,
      name: 'Pending CLA'
    });
    // test-user PR 1235
    expect(removeLabelStub.args[1][0]).to.include({
      issue_number: 1235,
      name: 'Pending CLA'
    });
    // test-user PR 1236
    expect(removeLabelStub.args[2][0]).to.include({
      issue_number: 1236,
      name: 'Pending CLA'
    });
  });

  it('should skip PRs without "Pending CLA" label', async function() {
    // Mock the response from search.issuesAndPullRequests
    // Docs for octokit.rest.search.issuesAndPullRequests - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/search/issuesAndPullRequests.md
    GitHub.app.octokit.rest.search.issuesAndPullRequests.resolves({
      data: {
        items: [
          {
            number: 1234,
            user: { login: 'test-user' },
            repository: { name: 'test-repo' },
            labels: [{ name: 'some-other-label' }]
          }
        ]
      }
    });

    // Call the afterCLA function
    await afterCLA(claSignatureInfo);

    // Verify that removeLabel was not called
    expect(GitHub.app.octokit.rest.issues.removeLabel.called).to.be.false;
  });

  it('should handle errors gracefully', async function() {
    // Mock the response from search.issuesAndPullRequests to throw an error
    GitHub.app.octokit.rest.search.issuesAndPullRequests.rejects(new Error('Test error'));

    try {
      // Call the afterCLA function
      await afterCLA(claSignatureInfo);
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect(error).to.be.an('error');
      expect(error.message).to.include('CLA verification');
    }
    // Verify that removeLabel was not called
    expect(removeLabelStub.callCount).to.be.equal(0);
  });
});
