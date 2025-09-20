import { expect } from 'chai';
import { describe, it } from 'mocha';
import { server } from '../../app.js';
import GitHub from '../../src/services/GitHub.js';

describe('App bootstrap', function () {
    this.timeout(40000);

    before(function () {
        
    });

    after(function () {
        server.close();
    });

    it('should bootstrap the GitHub app', function () {
        // GitHub app is bootstrapped in app.js automatically
        expect(GitHub.app).to.exist;
    });

});