/**
 * Service for interacting with external APIs to get next actions
 */
export class DocsAgent {
  constructor() {
    this.apiUrl = process.env.DOCS_AGENT_API_URL;
    this.apiKey = process.env.DOCS_AGENT_API_KEY;
    this.timeout = parseInt(process.env.DOCS_AGENT_API_TIMEOUT) || 350000; // 5+ minutes default
  }

  /**
   * For comprehensiveness and standardization of the docs
   * @param {*} content 
   * @param {*} fullPath 
   * @returns 
   */
  reviewDocs(content, fullPath) {
    return this.makeAPICall("/review", {
      content,
      fullPath,
    });
  }

  /**
   * For technical accuracy of the docs
   * @param {*} content 
   * @param {*} fullPath 
   * @returns 
   */
  auditDocs(content, fullPath) {
    return this.makeAPICall("/audit", {
      content,
      fullPath,
    });
  }

  /**
   * Get next actions from external API
   * @param {Object} changes - Formatted PR changes
   * @returns {Promise<string>} - Comment text for the PR
   */
  async getAffectedDocsPages(changes) {
    throw new Error("Not implemented");
    if (!this.apiUrl || !this.apiKey) {
      throw new Error("External API configuration missing. Please set EXTERNAL_API_URL and EXTERNAL_API_KEY environment variables.");
    }

    try {
      const response = await this.makeAPICall(changes);
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
  async makeAPICall(endpoint, requestBody) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.apiUrl + endpoint, {
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

      const data = await response.json();
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
  validateResponse(response) {
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
    return !!(this.apiUrl && this.apiKey);
  }
}

export default new DocsAgent();