/**
 * Integration tests for API key authentication functionality.
 */
import { expect, use } from 'chai';
import chaiHttp from 'chai-http';
import { describe, it, before, after } from 'mocha';

const chai = use(chaiHttp);
const SITE_URL = 'http://localhost:' + (process.env.PORT || 3000);

describe('API Key Authentication', function () {
    this.timeout(40000);
    let agent;

    before(function () {
        agent = chai.request.agent(SITE_URL);
        // Not setting API key here because it's set in the lifecycle test
    });

    after(function () {
        agent.close();
    });

    describe('POST /api/comment endpoint', function () {
        const validPayload = {
            owner: 'test-org',
            repo: 'test-repo',
            issue_number: 123,
            result: 'Test comment'
        };

        it('should return 401 when no API key is provided', async function () {
            const res = await agent
                .post('/api/comment')
                .send(validPayload);
            
            expect(res).to.have.status(401);
            expect(res.text).to.equal('API key required');
        });

        it('should return 401 when invalid X-API-Key is provided', async function () {
            const res = await agent
                .post('/api/comment')
                .set('X-API-Key', 'invalid-key')
                .send(validPayload);
            
            expect(res).to.have.status(401);
            expect(res.text).to.equal('API key required');
        });

        it('should return 401 when invalid Authorization Bearer is provided', async function () {
            const res = await agent
                .post('/api/comment')
                .set('Authorization', 'Bearer invalid-key')
                .send(validPayload);
            
            expect(res).to.have.status(401);
            expect(res.text).to.equal('API key required');
        });

        it('should accept valid X-API-Key header', async function () {
            const res = await agent
                .post('/api/comment')
                .set('X-API-Key', 'test-api-key')
                .send(validPayload);
            
            // Should not return 401 (authentication passed)
            // Note: This might return 400/500 due to GitHub API calls in test environment
            // but the important thing is that it's not 401
            expect(res).to.not.have.status(401);
        });

        it('should accept valid Authorization Bearer header', async function () {
            const res = await agent
                .post('/api/comment')
                .set('Authorization', 'Bearer test-api-key')
                .send(validPayload);
            
            // Should not return 401 (authentication passed)
            // Note: This might return 400/500 due to GitHub API calls in test environment
            // but the important thing is that it's not 401
            expect(res).to.not.have.status(401);
        });

        it('should prioritize X-API-Key over Authorization header when both are present', async function () {
            const res = await agent
                .post('/api/comment')
                .set('X-API-Key', 'test-api-key')
                .set('Authorization', 'Bearer invalid-key')
                .send(validPayload);
            
            // Should not return 401 (X-API-Key takes precedence)
            expect(res).to.not.have.status(401);
        });
    });
});
