/**
 * The first test file to run.
 * Sets up the test environment.
 */

import { spawn } from 'child_process';
import { once } from 'events';

let appProcess;

// Setup mocha tasks before and after all tests.
before(async function () {
    // Setup the test environment.
    // If e2e tests are being run, run the app in the test environment.
    if (process.env.RUN_E2E_TESTS === 'true') {
        // Run the app in the test environment.
        appProcess = spawn('node', ['app.js'], {
            env: { ...process.env, NODE_ENV: 'test' },
            stdio: 'pipe'
        });

        // Wait for the server to start
        await new Promise((resolve, reject) => {
            let buffer = '';
            const timeout = setTimeout(() => {
                reject(new Error('Timeout: Server did not start within the expected time'));
            }, 30000); // 30 seconds timeout

            appProcess.stdout.on('data', (data) => {
                buffer += data.toString();
                if (buffer.includes('Server is listening for events at:')) {
                    clearTimeout(timeout);
                    console.log('App started for e2e tests');
                    resolve();
                }
            });

            appProcess.on('error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to start server: ${err.message}`));
            });

            appProcess.on('exit', (code) => {
                clearTimeout(timeout);
                if (code !== 0) {
                    reject(new Error(`Server process exited with code ${code}`));
                }
            });
        });
    }
});

after(async function () {
    // Teardown the test environment.
    // If e2e tests are being run, stop the app.
    // Stop the app.
    if (appProcess) {
        appProcess.kill();
        await once(appProcess, 'exit');
        console.log('App stopped after e2e tests');
    }
});
