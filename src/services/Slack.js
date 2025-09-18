/**
 * Service for interacting with Slack
 */

class Slack {
  constructor() {
    this.defaultMessageChannelWebhook = process.env.SLACK_DEFAULT_MESSAGE_CHANNEL_WEBHOOK_URL;
  }

  static async sendMessage(message, {
    webhookUrl = this.defaultMessageChannelWebhook
  }) {
    if (!webhookUrl) {
      throw new Error("Slack webhook URL is not set");
    }

    if(!message) {
      throw new Error("Message is not set");
    }

    const payload = { text: message };
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }
  }
}

export default Slack;