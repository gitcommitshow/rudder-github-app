/**
 * E2E tests for the slack related services.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import Slack from '../../src/services/Slack.js';

describe('Slack Services', function () {
    this.timeout(40000);

    describe('sendMessage', function () {
        // Happy path
        it('should send a message to the default channel', async function () {
            const res = await Slack.sendMessage(':mag: <https://github.com/gitcommitshow/rudder-github-app/pull/82|#82: Test message from our GitHub App>\n*Author:* gitcommitshow\n*Created:* Sep 18, 2025 at 10:00 AM\n\n<!channel>', {
                webhookUrl: "https://hooks.slack.com/services/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"
            });
            expect(res).to.not.throw;
        });

        // Error path 1 - no message
        it('should throw an error if the message is not set', async function () {
            expect(Slack.sendMessage(null, {
                webhookUrl: "https://hooks.slack.com/services/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"
            })).to.throw;
        });

        // Error path 2 - no webhook url
        it('should throw an error if the webhook url is not set', async function () {
            expect(Slack.sendMessage("testing error path 2 - no webhook url")).to.throw;
        });
    });

})