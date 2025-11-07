/**
 * The first test file to run.
 * Sets up the test environment.
 */
import { spawn } from 'child_process';
import { once } from 'events';

let appProcess;

before(async function () {
    this.timeout(60000);

    if (process.env.RUN_E2E_TESTS === 'true') {
        try {

            if (!process.env.API_KEY) {
                process.env.API_KEY = 'test-api-key';
            }

            appProcess = spawn('node', ['app.js'], {
                env: { ...process.env, NODE_ENV: 'test' },
                stdio: 'pipe'
            });

            await new Promise((resolve, reject) => {
                let buffer = '';
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout: Server did not start within the expected time'));
                }, 30000);

                appProcess.stdout.on('data', (data) => {
                    buffer += data.toString();
                    if (buffer.includes('Server is running at:')) {
                        clearTimeout(timeout);
                        console.log('App started for e2e tests');
                        resolve();
                    }
                });

                appProcess.stderr.on('data', (data) => {
                    console.error(`Server logs: ${data}`);
                });

                appProcess.on('error', (err) => {
                    console.error(`Server error: ${err?.message}`);
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
        } catch (error) {
            console.error('Error in before hook:', error);
            throw error;
        }
    }
});

after(async function () {
    if (appProcess) {
        try {
            appProcess.kill();
            await Promise.race([
                once(appProcess, 'exit'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Process kill timeout')), 5000))
            ]);
            console.log('App stopped after e2e tests');
        } catch (error) {
            console.error('Error stopping app:', error);
        }
    }
});