/**
 * Service for interacting with docs agent external APIs to get next actions
 * 
 * @example
 * const docsAgent = new DocsAgent();
 * const result = await docsAgent.reviewDocs("content", "filepath", { webhookUrl: "webhookUrl", webhookMetadata: { owner: "owner", repo: "repo", issue_number: "issue_number" } });
 * console.log(result);
 */
export class DocsAgent {
  constructor() {
    this.apiUrl = process.env.DOCS_AGENT_API_URL;
    this.apiKey = process.env.DOCS_AGENT_API_KEY;
    this.reviewDocsApiUrl = process.env.DOCS_AGENT_API_REVIEW_URL;
    this.auditDocsApiUrl = process.env.DOCS_AGENT_API_AUDIT_URL;
    this.prioritizeDocsApiUrl = process.env.DOCS_AGENT_API_PRIORITIZE_URL;
    this.editDocsApiUrl = process.env.DOCS_AGENT_API_EDIT_URL;
    this.linkDocsApiUrl = process.env.DOCS_AGENT_API_LINK_URL;
    this.timeout = parseInt(process.env.DOCS_AGENT_API_TIMEOUT) || 350000; // 5+ minutes default
  }

  /**
   * For comprehensiveness and standardization of the docs
   * @param {*} content 
   * @param {*} filepath - complete remote file path
   * @returns {Promise<string>} - Comment text for the PR
   */
  async reviewDocs(content, filepath, webhookInfoForResults) {
    return this.makeAPICall(this.reviewDocsApiUrl || "/review", {
      content,
      filepath,
      webhookUrl: webhookInfoForResults?.webhookUrl,
      webhookMetadata: webhookInfoForResults?.webhookMetadata,
    });
  }

  /**
   * For technical accuracy of the docs
   * @param {*} content 
   * @param {*} filepath - complete remote file path
   * @returns {Promise<string>} - Comment text for the PR
   */
  async auditDocs(content, filepath, webhookInfoForResults) {
    return this.makeAPICall(this.auditDocsApiUrl || "/audit", {
      content,
      filepath,
      webhookUrl: webhookInfoForResults?.webhookUrl,
      webhookMetadata: webhookInfoForResults?.webhookMetadata,
    });
  }

  /**
   * Get next actions from external API
   * @param {Object} changes - Formatted PR changes
   * @returns {Promise<string>} - Comment text for the PR
   */
  async getAffectedDocsPages(changes, webhookInfoForResults) {
    throw new Error("Not implemented");
    if (!this.apiUrl || !this.apiKey) {
      throw new Error("External API configuration missing. Please set EXTERNAL_API_URL and EXTERNAL_API_KEY environment variables.");
    }

    try {
      const response = await this.makeAPICall("/getAffectedDocsPages", changes, webhookInfoForResults);
      return this.validateResponse(response);
    } catch (error) {
      console.error("External API call failed:", error);
      throw new Error(`Failed to get next actions: ${error.message}`);
    }
  }

  /**
   * Make the actual API call to the docs agent api
   * @param {Object} requestBody - the request body as JSON
   * @returns {Promise<Object>} - API response
   */
  async makeAPICall(endpoint, requestBody = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const apiUrl = (endpoint && endpoint.startsWith("/")) ? (this.apiUrl + endpoint) : endpoint;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'rudder-github-app/1.0',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
      }

      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        // Try to parse as JSON, but fallback to text if not possible
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = text;
        }
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('API request timed out');
      }
      throw error;
    }
  }

  /**
   * Validate and extract comment from API response
   * @param {Object} response - API response
   * @returns {string} - Comment text
   */
  validateResponse(response = {}) {
    if (!response) {
      throw new Error("Empty response from external API");
    }

    // Expected response format: { comment: "..." }
    if (response.comment && typeof response.comment === 'string') {
      return response.comment;
    }

    // Fallback: if response is a string, use it directly
    if (typeof response === 'string') {
      return response;
    }

    // Fallback: if response has a message field
    if (response.message && typeof response.message === 'string') {
      return response.message;
    }

    throw new Error("Invalid response format from external API. Expected 'comment' field.");
  }

  /**
   * Check if the service is properly configured
   * @returns {boolean} - True if configured
   */
  isConfigured() {
    console.log("Checking if DocsAgent is configured", this.apiUrl, this.apiKey);
    return !!(this.apiUrl && this.apiKey);
  }
}

export default new DocsAgent();