/**
 * E2E tests for the slack related services.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import Slack from '../../src/services/Slack.js';
import dotenv from 'dotenv';

describe('Slack Services', function () {
    this.timeout(40000);

    before(function () {
        console.log("⚠️ Running slack e2e tests with real env vars");
        dotenv.config();
        if(!process.env.SLACK_DEFAULT_MESSAGE_CHANNEL_WEBHOOK_URL){
            console.error("❌ SLACK_DEFAULT_MESSAGE_CHANNEL_WEBHOOK_URL env is not set. Skipping slack e2e tests.");
            this.skip();
        }
    });

    describe('sendMessage', function () {
        // Happy path
        it('should send a message to the default channel', async function () {
            const res = await Slack.sendMessage(':mag: <https://github.com/gitcommitshow/rudder-github-app/pull/82|#82: Test message from our GitHub App>\n*Author:* gitcommitshow\n*Created:* Sep 18, 2025 at 10:00 AM\n\n<!channel>', {
                webhookUrl: process.env.SLACK_DEFAULT_MESSAGE_CHANNEL_WEBHOOK_URL
            });
            expect(res).to.not.throw;
        });

        // Error path 1 - no message
        it('should throw an error if the message is not set', async function () {
            expect(Slack.sendMessage()).to.throw;
        });
    });

})