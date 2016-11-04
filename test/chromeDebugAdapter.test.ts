/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';
import {ChromeConnection, ISourceMapPathOverrides} from 'vscode-chrome-debug-core';

import * as mockery from 'mockery';
import {EventEmitter} from 'events';
import * as assert from 'assert';
import {Mock, MockBehavior, It} from 'typemoq';

import {getMockChromeConnectionApi, IMockChromeConnectionAPI} from './debugProtocolMocks';
import * as testUtils from './testUtils';

/** Not mocked - use for type only */
import {ChromeDebugAdapter as _ChromeDebugAdapter} from '../src/chromeDebugAdapter';

class MockChromeDebugSession {
    public sendEvent(event: DebugProtocol.Event): void {
    }

    public sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void {
    }
}

const MODULE_UNDER_TEST = '../src/chromeDebugAdapter';
suite('ChromeDebugAdapter', () => {
    let mockChromeConnection: Mock<ChromeConnection>;
    let mockEventEmitter: EventEmitter;
    let mockChrome: IMockChromeConnectionAPI;

    let chromeDebugAdapter: _ChromeDebugAdapter;

    setup(() => {
        testUtils.setupUnhandledRejectionListener();
        mockery.enable({ useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false });

        // Create a ChromeConnection mock with .on and .attach. Tests can fire events via mockEventEmitter
        mockChromeConnection = Mock.ofType(ChromeConnection, MockBehavior.Strict);
        mockChrome = getMockChromeConnectionApi();
        mockEventEmitter = mockChrome.mockEventEmitter;
        mockChromeConnection
            .setup(x => x.api)
            .returns(() => mockChrome.apiObjects);
        mockChromeConnection
            .setup(x => x.attach(It.isValue(undefined), It.isAnyNumber(), It.isValue(undefined)))
            .returns(() => Promise.resolve());
        mockChromeConnection
            .setup(x => x.isAttached)
            .returns(() => false);
        mockChromeConnection
            .setup(x => x.run())
            .returns(() => Promise.resolve());
        mockChromeConnection
            .setup(x => x.onClose(It.isAny()));

        // Instantiate the ChromeDebugAdapter, injecting the mock ChromeConnection
        const cDAClass: typeof _ChromeDebugAdapter = require(MODULE_UNDER_TEST).ChromeDebugAdapter;
        chromeDebugAdapter = new cDAClass({ chromeConnection: function() { return mockChromeConnection.object; } } as any, new MockChromeDebugSession() as any);
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();
        mockery.deregisterAll();
        mockery.disable();
        mockChromeConnection.verifyAll();
    });

    suite('launch()', () => {
        test('launches with minimal correct args', () => {
            let spawnCalled = false;
            function spawn(chromePath: string, args: string[]): any {
                // Just assert that the chrome path is some string with 'chrome' in the path, and there are >0 args
                assert(chromePath.toLowerCase().indexOf('chrome') >= 0);
                assert(args.indexOf('--remote-debugging-port=9222') >= 0);
                assert(args.indexOf('file:///c:/path%20with%20space/index.html') >= 0);
                assert(args.indexOf('abc') >= 0);
                assert(args.indexOf('def') >= 0);
                spawnCalled = true;

                return { on: () => { }, unref: () => { } };
            }

            // Mock spawn for chrome process, and 'fs' for finding chrome.exe.
            // These are mocked as empty above - note that it's too late for mockery here.
            require('child_process').spawn = spawn;
            require('fs').statSync = () => true;

            mockChromeConnection
                .setup(x => x.attach(It.isValue(undefined), It.isAnyNumber(), It.isAnyString()))
                .returns(() => Promise.resolve())
                .verifiable();

            mockChrome.Runtime
                .setup(x => x.evaluate(It.isAny()))
                .returns(() => Promise.resolve({ result: { value: '123' }}));

            return chromeDebugAdapter.launch({ file: 'c:\\path with space\\index.html', runtimeArgs: ['abc', 'def'] })
                .then(() => assert(spawnCalled));
        });
    });

    suite('resolveWebRootPattern', () => {
        const WEBROOT = testUtils.pathResolve('/project/webroot');
        const resolveWebRootPattern = require(MODULE_UNDER_TEST).resolveWebRootPattern;

        test('does nothing when no ${webRoot} present', () => {
            const overrides: ISourceMapPathOverrides = { '/src': '/project' };
            assert.deepEqual(
                resolveWebRootPattern(WEBROOT, overrides),
                overrides);
        });

        test('resolves the webRoot pattern', () => {
            assert.deepEqual(
                resolveWebRootPattern(WEBROOT, <ISourceMapPathOverrides>{ '/src': '${webRoot}/app/src'}),
                { '/src': WEBROOT + '/app/src' });
        });

        test(`ignores the webRoot pattern when it's not at the beginning of the string`, () => {
            const overrides: ISourceMapPathOverrides = { '/src': '/app/${webRoot}/src'};
            assert.deepEqual(
                resolveWebRootPattern(WEBROOT, overrides),
                overrides);
        });

        test('works on a set of overrides', () => {
            const overrides: ISourceMapPathOverrides = {
                '/src*': '${webRoot}/app',
                '*/app.js': '*/app.js',
                '/src/app.js': '/src/${webRoot}',
                '/app.js': '${webRoot}/app.js'
            };

            const expOverrides: ISourceMapPathOverrides = {
                '/src*': WEBROOT + '/app',
                '*/app.js': '*/app.js',
                '/src/app.js': '/src/${webRoot}',
                '/app.js': WEBROOT + '/app.js'
            };

            assert.deepEqual(
                resolveWebRootPattern(WEBROOT, overrides),
                expOverrides);
        });
    })
});