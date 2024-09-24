/**
 * Integration tests for the helpers module.
 */
import { expect } from 'chai';
import sinon from 'sinon';
import { afterCLA } from '../../src/helpers.js';

describe('afterCLA', function() {
  let app, claSignatureInfo, removeLabelStub;

  beforeEach(function() {
    removeLabelStub = sinon.stub();
    app = {
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
        iterator: sinon.stub().returns([{ installation: { id: 1 } }])
      },
      eachRepository: {
        iterator: sinon.stub().returns([{ octokit: { rest: { issues: { removeLabel: removeLabelStub } } }, repository: { owner: { login: 'test-org' }, name: 'test-repo' } }])
      }
    };

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
    app.octokit.rest.search.issuesAndPullRequests.resolves({
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
    await afterCLA(app, claSignatureInfo);

    // Verify that removeLabel was called
    expect(removeLabelStub.calledOnce).to.be.true;
    expect(removeLabelStub.calledWith({
      owner: 'test-org',
      repo: 'test-repo',
      issue_number: 1234,
      name: 'Pending CLA'
    })).to.be.true;
  });

  it('should skip PRs without "Pending CLA" label', async function() {
    // Mock the response from search.issuesAndPullRequests
    app.octokit.rest.search.issuesAndPullRequests.resolves({
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
    await afterCLA(app, claSignatureInfo);

    // Verify that removeLabel was not called
    expect(app.octokit.rest.issues.removeLabel.called).to.be.false;
  });

  it('should handle errors gracefully', async function() {
    // Mock the response from search.issuesAndPullRequests to throw an error
    app.octokit.rest.search.issuesAndPullRequests.rejects(new Error('Test error'));

    // Call the afterCLA function
    await afterCLA(app, claSignatureInfo);

    // Verify that removeLabel was not called
    expect(removeLabelStub.called).to.be.false;
  });
});
