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

    describe('GET /cla', function () {
        it('should return the CLA page', async function () {
            const res = await agent.get('/cla');
            expect(res).to.have.status(200);
        });
    });

    describe('POST /cla', function () {
        context("with incomplete input data", function () {
            it('should redirect back to the same page', async function () {
                const res = await agent
                    .post('/cla')
                    .redirects(0); // Do not follow redirect
                expect(res).to.redirect;
                expect(res).to.redirectTo("/cla");
            });
        });
        context("with valid input without referring pr info", function () {
            it('should return 200 status', async function () {
                const res = await agent
                    .post('/cla')
                    .send('terms=on&email=test@example.com&username=testGhUser')
                    .redirects(0); // Do not follow redirect
                expect(res).to.not.redirect;
            });
        });
        context("with valid input including valid referring pr info", function () {
            it('should return the CLA page', async function () {
                const referrer = "https://localhost:3000/cla?org=Git-Commit-Show&repo=gcs-cli&prNumber=181&username=githubUsername";
                const prReferrer = "https://github.com/Git-Commit-Show/gcs-cli/pull/181";
                const res = await agent
                    .post('/cla')
                    .send('terms=on&email=test@example.com&username=gitcommitshow&referrer='
                        + encodeURIComponent(referrer))
                    .redirects(0); // Do not follow redirect;
                expect(res).to.have.status(302);
                expect(res).to.redirectTo(prReferrer);
            });
        });
    });
});
