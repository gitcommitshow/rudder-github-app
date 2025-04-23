/**
 * Automated action to improve docs
 */

/**
 * Scan files under a directory in a repo to find files that need to be improved
 * Returns the list of files that need to be improved
 * A recurring task that initiates the docs improvement pipeline
 * Triggered by: Schedule (every week)
 * @param {string} owner 
 * @param {string} repo 
 * @returns {Promise<String[]>} list of files
 */
async function scan(owner, repo) {
    console.log("Scanning configuration for improvement scope and opportunities");
    // Get the list of files that need improvement as per master configuration
}

/**
 * Creates an actionable issue for the improvement of particular docs page
 * Triggered by: Scan
 * @param {string} owner 
 * @param {string} repo 
 * @param {string[]} files - The list of files to improve
 */
async function reviewAndPrioritize(owner, repo, files) {
    console.log("Reviewing and prioritizing the docs pages for improvement in "+ files.join(", "));
    // Get the file content
    // Call the ai review + prioritize endpoint
    // Create a new issue with the results
}

/**
 * Get the list of active docs improvement tasks
 * @param {string} owner 
 * @param {string} repo 
 * @returns {Promise<Issue[]>} list of issues
 */
async function getActiveDocsImprovementTasks(owner, repo) {
    // Get the list of issues that are related to the improvement of a docs page
    // Make sure we have their labels and status
}

/**
 * Create a new issue in Github
 * @param {string} owner 
 * @param {string} repo 
 * @param {string} path 
 * @param {string} title 
 * @param {string} body 
 */
async function createIssue(owner, repo, path, title, body) {

}

/**
 * 
 * @param {string} owner 
 * @param {string} repo 
 * @param {string} issue 
 */
async function onIssueLabelChange(owner, repo, issue) { 
    // Verify that the issue is related to the improvement of a docs page
    // Verify that the issue is approved to be processed
    // Extract the filepath and the instructions from the issue title and body and comment on the issue with the results
    // Trigger file edit
    // Update the issue status to "In Progress"
}


/**
 * Edit a file in the repo
 * Triggered by: Issue label change
 * @param {string} owner 
 * @param {string} repo 
 * @param {string} filepath 
 * @param {string} content 
 */
async function editFile(owner, repo, filepath, content, issue) {
    // Call the ai edit endpoint
    // Create a new branch
    // Commit the changes in the file
    // Create a PR
    // Link the PR to the issue
}

/**
 * Find issues related to the improvement of a particular file
 * @param {string} owner 
 * @param {string} repo 
 * @param {string} filepath 
 * @returns {Promise<Issue[]>} list of issues
 */
async function findRelatedIssues(owner, repo, filepath) {
    // Get the list of issues that are related to the improvement of the file
    // Make sure we have their labels and status
}