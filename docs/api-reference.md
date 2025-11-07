# API Reference

This document describes all publicly exposed API endpoints.

## Base URL

The API is served from the configured domain (set via `WEBSITE_ADDRESS` environment variable) or `http://localhost:3000` for local development.

## Authentication

Most endpoints do not require authentication. However, some endpoints require specific authentication:

- **API endpoints**: Require API key authentication via request header (using `API_KEY` environment variable)
- **Download endpoints**: Require username/password authentication via request body (using `LOGIN_USER` and `LOGIN_PASSWORD` environment variables)
- **GitHub webhook endpoints**: Use GitHub webhook secret for verification
- **GitHub API interactions**: Use GitHub App authentication

### API Key Authentication

For endpoints requiring API key authentication, include one of the following headers:

- `X-API-Key: <your-api-key>`
- `Authorization: Bearer <your-api-key>`

The API key must match the value set in the `API_KEY` environment variable. If the API key is missing or invalid, the endpoint will return `401 Unauthorized`.

## Endpoints

### Webhook Endpoints

#### `POST /api/webhook`

GitHub webhook endpoint for receiving GitHub events.

**Description**: This endpoint receives webhook events from GitHub and processes them according to the configured event handlers.

**Headers**:
- `Content-Type: application/json`
- `X-GitHub-Event`: GitHub event type
- `X-Hub-Signature-256`: GitHub webhook signature

**Request Body**: GitHub webhook payload (varies by event type)

**Response**:
- `200 OK`: Webhook processed successfully
- `400 Bad Request`: Invalid webhook signature or payload

**Supported Events**:
- `pull_request.opened`: Adds "Pending CLA" label to PRs requiring CLA
- `pull_request.labeled`: Handles label-specific actions (CLA, product review, docs review)
- `pull_request.closed`: Sends post-merge messages
- `issues.opened`: Adds welcome comment to new issues
- `push`: Logs push events

**Note**: For "docs review" label, the app integrates with DocsAgent service if configured. This is limited to repositories specified in the `DOCS_REPOS` environment variable. The DocsAgent service uses the `API_POST_GITHUB_COMMENT` environment variable (or defaults to `WEBSITE_ADDRESS/api/comment`) to post review results back to GitHub.

---

### CLA (Contributor License Agreement) Endpoints

#### `GET /cla`

Displays the CLA form page.

**Description**: Serves the HTML page for contributors to sign the CLA.

**Response**:
- `200 OK`: HTML page with CLA form
- `404 Not Found`: CLA form file not found

#### `POST /cla`

Submits a CLA form.

**Description**: Processes CLA form submissions and updates PR status.

**Request Body** (form-encoded):
- `terms` (string): Must be "on" to accept terms
- `legalName` (string): Contributor's legal name
- `username` (string): GitHub username
- `email` (string): Contributor's email address
- `referrer` (string, optional): URL that referred to this form

**Response**:
- `302 Found`: Redirects to PR or success page
- `200 OK`: Success message with CLA details

**Success Response**: HTML page confirming CLA submission with contributor details.

**Example**:
```bash
curl -X POST http://localhost:3000/cla \
  -d "terms=on&legalName=John Doe&username=johndoe&email=john@example.com"
```

---

### Download Endpoints

#### `GET /download`

Displays the download center page.

**Description**: Serves the HTML page for downloading contribution data.

**Response**:
- `200 OK`: HTML page with download form
- `404 Not Found`: Download page file not found

#### `POST /download`

Downloads contribution data in various formats.

**Description**: Authenticates user and provides CLA data in JSON or CSV format.

**Request Body** (form-encoded):
- `username` (string): Authentication username (must match `LOGIN_USER` env variable)
- `password` (string): Authentication password (must match `LOGIN_PASSWORD` env variable)
- `format` (string, optional): "json" or "csv" (defaults to CSV)

**Response**:
- `200 OK`: File download with appropriate headers
- `404 Not Found`: Authentication failed (Note: This endpoint returns `404 Not Found` for failed authentication attempts, which is unconventional but matches the implementation)

**Response Headers**:
- `Content-Disposition: attachment; filename=data.json` (for JSON)
- `Content-Disposition: attachment; filename=data.csv` (for CSV)
- `Content-Type: application/json` (for JSON)
- `Content-Type: text/csv` (for CSV)

**Note**: Authentication is rate-limited. After 3 failed attempts, the account is temporarily locked.

**Example**:
```bash
curl -X POST http://localhost:3000/download \
  -d "username=admin&password=secret&format=json"
```

---

### Contribution Management Endpoints

#### `GET /contributions/sync`

Synchronizes pull request data.

**Description**: Currently returns a 404 error (not fully implemented).

**Response**:
- `404 Not Found`: "Not implemented yet" message

#### `GET /contributions`

Lists pull requests and contributions.

**Description**: Retrieves and displays pull request data with filtering options.

**Query Parameters**:
- `org` (string, required): GitHub organization name
- `repo` (string, optional): Specific repository name
- `page` (number, optional): Page number for pagination
- `status` (string, optional): PR status filter ("open", "closed")
- `after` (string, optional): Filter PRs created after this date (YYYY-MM-DD)
- `before` (string, optional): Filter PRs created before this date (YYYY-MM-DD)
- `merged` (boolean, optional): Filter by merge status ("true", "false")

**Note**: `after` and `before` parameters cannot be used together.

**Response**:
- `200 OK`: HTML page with contribution data or JSON data
- `400 Bad Request`: Missing required parameters or invalid parameter combination

**Content-Type**: 
- `text/html`: Default HTML response
- `application/json`: If `Accept: application/json` header is sent in the request

**Example**:
```bash
curl -H "Accept: application/json" \
  "http://localhost:3000/contributions?org=myorg&status=open"
```

#### `GET /contributions/pr`

Gets detailed information about a specific pull request.

**Description**: Retrieves detailed information about a single pull request.

**Query Parameters**:
- `org` (string, required): GitHub organization name
- `repo` (string, required): Repository name
- `number` (number, required): Pull request number

**Response**:
- `200 OK`: HTML page with PR details or JSON data
- `400 Bad Request`: Missing required parameters

**Content-Type**:
- `text/html`: Default HTML response
- `application/json`: If `Accept: application/json` header is sent in the request

#### `GET /contributions/reset`

Clears the contribution data cache.

**Description**: Resets cached contribution data.

**Response**:
- `200 OK`: "Cache cleared" message

---

### Comment Management Endpoints

#### `POST /api/comment`

Adds a comment to a GitHub issue or pull request.

**Description**: Adds a comment to a specified GitHub issue or PR (used by external services like docs agent).

**Authentication**: Requires API key authentication via `X-API-Key` or `Authorization: Bearer <key>` header.

**Request Body** (JSON):
```json
{
  "owner": "string",
  "repo": "string", 
  "issue_number": number,
  "result": "string"
}
```

**Response**:
- `200 OK`: "Comment added to GitHub issue or PR"
- `400 Bad Request`: Missing required parameters
- `401 Unauthorized`: API key missing or invalid
- `500 Internal Server Error`: Failed to add comment

**Example**:
```bash
curl -X POST http://localhost:3000/api/comment \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"owner":"myorg","repo":"myrepo","issue_number":123,"result":"Review completed"}'
```

---

### General Endpoints

#### `GET /`

Displays the home page.

**Description**: Serves the main application homepage.

**Response**:
- `200 OK`: HTML home page
- `404 Not Found`: Home page file not found

#### `GET /*` (Default Route)

Handles unmatched routes.

**Description**: Returns 404 for any unmatched paths.

**Response**:
- `404 Not Found`: "Path not found!" message

---

## Error Responses

All endpoints may return the following error responses:

- `400 Bad Request`: Invalid request parameters or missing required fields
- `404 Not Found`: Resource not found or authentication failed
- `500 Internal Server Error`: Server-side error during processing

## Rate Limiting

The application respects GitHub API rate limits and implements caching to minimize API calls. For download endpoints, there's a limit of 3 failed login attempts before temporary account lockout.

## Environment Variables

The following environment variables affect API behavior:

### Server Configuration
- `PORT`: Server port (default: 3000)
- `WEBSITE_ADDRESS`: Public URL for the application
- `NODE_ENV`: Node environment (e.g., "production", "development")

### GitHub App Authentication
- `APP_ID`: GitHub App ID
- `PRIVATE_KEY_PATH`: Path to GitHub App private key file
- `GITHUB_APP_PRIVATE_KEY_BASE64`: Base64-encoded private key (alternative to file)
- `WEBHOOK_SECRET`: GitHub webhook secret for verification
- `ENTERPRISE_HOSTNAME`: GitHub Enterprise hostname (if applicable)

### API Authentication
- `API_KEY`: API key for protecting API endpoints (e.g., `/api/comment`)

### Download Endpoint Authentication
- `LOGIN_USER`: Username for download authentication
- `LOGIN_PASSWORD`: Password for download authentication

### DocsAgent Integration
- `DOCS_AGENT_API_URL`: Base URL for DocsAgent API
- `DOCS_AGENT_API_KEY`: API key for DocsAgent
- `DOCS_AGENT_API_REVIEW_URL`: URL for docs review endpoint
- `DOCS_AGENT_API_AUDIT_URL`: URL for docs audit endpoint
- `DOCS_AGENT_API_PRIORITIZE_URL`: URL for docs prioritization endpoint
- `DOCS_AGENT_API_EDIT_URL`: URL for docs editing endpoint
- `DOCS_AGENT_API_LINK_URL`: URL for docs linking endpoint
- `DOCS_AGENT_API_TIMEOUT`: Timeout for DocsAgent API calls (default: 350000ms)
- `DOCS_REPOS`: Comma-separated list of repositories eligible for docs review
- `API_POST_GITHUB_COMMENT`: Webhook URL for DocsAgent to post result back to (defaults to `our WEBSITE_ADDRESS/api/comment` where we have configured github issue/pr comments). Allows use case to use a proxy url for this webhook url in staging server.

### Development & Deployment
- `DEFAULT_GITHUB_ORG`: Default GitHub organization
- `GITHUB_BOT_USERS`: Comma-separated list of GitHub bot usernames to ignore
- `GITHUB_ORG_MEMBERS`: Comma-separated list of organization members to ignore
- `ONE_CLA_PER_ORG`: If "true", one CLA signature is valid for all repos in an org
- `CODESANDBOX_HOST`: CodeSandbox host (for staging environments)
- `HOSTNAME`: Hostname for the application
- `SMEE_URL`: Smee proxy URL for local development

### Slack Integration
- `SLACK_DEFAULT_MESSAGE_CHANNEL_WEBHOOK_URL`: Slack webhook URL for sending notifications when PRs are labeled with "product review"