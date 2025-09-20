/**
 * E2E tests for the github related services.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { server } from '../../app.js';
import Github from '../../src/services/GitHub.js';

describe('GitHub Services', function () {
    this.timeout(40000);
    
    after(function () {
        server.close();
    });

    describe('getPullRequest', function () {
        // Happy path
        it('should get a pull request', async function () {
            const res = await Github.getPRChanges('gitcommitshow', 'rudder-github-app', 82);
            expect(res).to.not.throw;
            expect(res).to.exist;
            expect(res).to.have.property('title');
            expect(res).to.have.property('description');
            expect(res).to.have.property('files');
            expect(res).to.have.property('diff');
            expect(res).to.have.property('baseCommit');
            expect(res).to.have.property('headCommit');
            expect(res.files.length).to.be.greaterThan(0);
            expect(res.files[0]).to.have.property('filename');
            expect(res.files[0]).to.have.property('additions');
            expect(res.files[0]).to.have.property('deletions');
            expect(res.files[0]).to.have.property('changes');
            expect(res.files[0]).to.have.property('patch');
            expect(res.files[0]).to.have.property('content');
            expect(res.files[0]).to.have.property('size');
            expect(res.files[0]).to.have.property('sha');
            expect(res.files[0]).to.have.property('status');
        });

        // Error path
        it('should throw an error if the pull request is not found', async function () {
            expect(Github.getPRChanges('gitcommitshow', 'rudder-github-app', 9999)).to.throw;
        });
    });
});