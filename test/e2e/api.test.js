/**
 * E2E tests for the cla related routes.
 */
import { expect, use } from 'chai';
import chaiHttp from 'chai-http';
import { describe, it } from 'mocha';

const chai = use(chaiHttp);
const SITE_URL = 'http://localhost:' + (process.env.PORT || 3000);

describe('CLA Routes', function () {
    this.timeout(40000);
    let agent;
    before(function () {
        agent = chai.request.agent(SITE_URL);
    });

    after(function () {
        agent.close();
    });

    describe('POST /api/comment', function () {
        it('should return the comment added to GitHub issue or PR', async function () {
            const res = await agent.post('/api/comment').send({
                owner: 'Git-Commit-Show',
                repo: 'gcs-cli',
                issue_number: 7,
                result: 'Hello, world!',
            });
            expect(res).to.have.status(200);
            expect(res.text).to.include('Comment added to GitHub issue or PR');
        });
    });

});
