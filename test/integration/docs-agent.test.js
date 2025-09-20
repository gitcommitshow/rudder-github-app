/**
 * E2E tests for the docs agent related services.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { server } from '../../app.js';
import DocsAgent from '../../src/services/DocsAgent.js';

describe('Docs Agent Services', function () {
    this.timeout(40000);
    
    after(function () {
        server.close();
    });

    describe('reviewDocs', function () {
        it('should review the docs', async function () {
            const review = await DocsAgent.reviewDocs('Hello, world!', 'https://raw.githubusercontent.com/gitcommitshow/rudder-github-app/e14433e76d74dc680b8cf9102d39f31970e8b794/.codesandbox/tasks.json');
            expect(review).to.not.throw;
            expect(review).to.be.a('string');
            expect(review).to.not.be.empty;
        });
    });
});