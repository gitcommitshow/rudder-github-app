/**
 * E2E tests for the cla related routes.
 */
import { expect, use } from 'chai';
import chaiHttp from 'chai-http';
import { describe, it } from 'mocha';

const chai = use(chaiHttp);
const SITE_URL = 'http://localhost:' + (process.env.PORT || 3000);

describe('CLA Routes', function () {
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
        it('should return the CLA page', async function () {
            const res = await agent.post('/cla');
            expect(res).to.have.status(200);
        });
    });
});
