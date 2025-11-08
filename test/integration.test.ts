import { ConnectionStatus, ElectrumClient, ElectrumClientEvents, ElectrumSocket } from '@electrum-cash/network';
import { ElectrumTcpSocket } from '@electrum-cash/tcp-socket';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';
import { describe, expect, test } from 'vitest';
import { ElectrumFallbackClient } from '../source';
import { UseCase, useCases } from './use-cases';

// Declare use case as a global-scope reference variable.
let useCase: UseCase;

const hosts = ['bch.imaginary.cash', 'blackie.c3-soft.com'];
const rankingOptions = [
	false,
	true,
];

const initClientsWithSockets = (Socket: new (host: string, port: number, encrypted: boolean) => ElectrumSocket, port: number, encrypted: boolean) => {
	return hosts.map((host) => {
		// Configure an encrypted socket.
		const encryptedTcpSocket = new Socket(host, port, encrypted);

		// Initialize an electrum client.
		const electrumClient = new ElectrumClient('Electrum client test', '1.4.1', encryptedTcpSocket);
		return electrumClient;
	});
}

const initClientsWithHostnames = (hostNames?: string[]) => {
	return (hostNames ?? hosts).map((host) => {
		// Initialize an electrum client.
		const electrumClient = new ElectrumClient('Electrum client test', '1.4.1', host);
		return electrumClient;
	});
}

for (const rankingOption of rankingOptions) {
	describe(`ElectrumFallbackClient Integration Tests (ranking: ${rankingOption})`, () => {
		// Set up client request test
		const testEncryptedClientRequest = async function(): Promise<void>
		{
			// Configure an encrypted socket.
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumTcpSocket, 50002, true);

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Wait for the client to connect
			await electrum.connect();

			// Perform the request according to the use case.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		// Set up unencrypted client request test
		const testUnencryptedClientRequest = async function(): Promise<void>
		{
			// Configure an unencrypted socket.
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumTcpSocket, 50001, false);

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Wait for the client to connect
			await electrum.connect();

			// Perform the request according to the use case.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		// Set up client request test using WebSockets
		const testEncryptedWebSocketClientRequest = async function(): Promise<void>
		{
			// Configure a secured web socket.
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumWebSocket, 50004, true);

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Wait for the client to connect
			await electrum.connect();

			// Perform the request according to the use case.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		// Set up unencrypted client request test using WebSockets
		const testUnencryptedWebSocketClientRequest = async function(): Promise<void>
		{
			// Configure an unsecured web socket.
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumWebSocket, 50003, false);

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Wait for the client to connect
			await electrum.connect();

			// Perform the request according to the use case.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		const testRestartedClient = async function(): Promise<void>
		{
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithHostnames();

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Wait for the client to connect.
			await electrum.connect();

			// Close the connection.
			await electrum.disconnect();

			// Reconnect the client.
			await electrum.connect();

			// Perform the request according to the use case.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		const testRequestAbortOnConnectionLossClient = async function(): Promise<void>
		{
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithHostnames();

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Wait for the client to connect.
			await electrum.connect();

			// Perform the request according to the use case (but do not await it).
			// @ts-ignore
			const requestPromise = electrum.request(...useCase.request.input);

			// Immediately close the underlying connection.
			// @ts-ignore
			await electrum.disconnect();

			// Check that the request promise resolves with an Error indicating lost connection.
			expect(await requestPromise instanceof Error).toBeTruthy();
			expect((await requestPromise as Error).message).toEqual('Connection lost');
		};

		const testConnectOnAlreadyConnectedClient = async function(): Promise<void>
		{
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithHostnames();

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Invoke connect the first time and wait for it to be connected.
			await electrum.connect();

			// Attempt to invoke it a second time despite being already connected.
			// NOTE: It should return immediately as it is already connected and should not throw any errors in subsequent calls.
			await electrum.connect();

			// Perform a request according to the use case to ensure everything works as expected.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		const testSimultaneousConnectsOnClient = async function(): Promise<void>
		{
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithHostnames();

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Invoke multiple connects at once but DO NOT await them as want to test that this call can be made simultaneously.
			electrum.connect();
			electrum.connect();
			electrum.connect();

			// Now finally make one more connect call but this time await it.
			await electrum.connect();

			// Perform a request according to the use case to ensure everything works as expected.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		const testSimultaneousDisconnectsOnClient = async function(): Promise<void>
		{
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithHostnames();

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Invoke connect the first time and wait for it to be connected.
			await electrum.connect();

			// Invoke multiple disconnects at once but DO NOT await them as want to test that this call can be made simultaneously.
			electrum.disconnect();
			electrum.disconnect();
			electrum.disconnect();

			// Now finally make one more disconnect call but this time await it.
			await electrum.disconnect();

			// Connect again so that we can test our sample test-case.
			await electrum.connect();

			// Perform a request according to the use case to ensure everything works as expected.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		const testSimultaneousDisconnectAndConnectOnClient = async function(): Promise<void>
		{
			const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithHostnames();

			// Initialize an electrum client.
			const electrum = new ElectrumFallbackClient(clients, { rank: rankingOption });

			// Connect to our Electrum Client and await it to make sure it is successful.
			await electrum.connect();

			// Invoke a disconnect but do not await it so that we can make it race with the below connect() call.
			electrum.disconnect();

			// Connect to our Electrum Client.
			await electrum.connect();

			// Perform a request according to the use case to ensure everything works as expected.
			// @ts-ignore
			const requestOutput = await electrum.request(...useCase.request.input);

			// Close the connection synchronously.
			await electrum.disconnect();

			// Verify that the transaction hex matches expectations.
			expect(requestOutput).toEqual(useCase.request.output);
		};

		// Set up normal tests.
		const runNormalTests = async function(): Promise<void>
		{
			// For each use case to test..
			for(const currentUseCase in useCases)
			{
				// .. assign it to the use case global reference.
				useCase = useCases[currentUseCase];

				test('Request data from encrypted TCP client', testEncryptedClientRequest);
				test('Request data from unencrypted TCP client', testUnencryptedClientRequest);
				test('Request data from client using WebSocket connection', testEncryptedWebSocketClientRequest);
				test('Request data from unencrypted client using WebSocket connection', testUnencryptedWebSocketClientRequest);
				test('Request data after restarting client', testRestartedClient);
				test('Abort active request on connection loss for a client', testRequestAbortOnConnectionLossClient);
				test('Test connect() on already connected client', testConnectOnAlreadyConnectedClient);
				test('Test simultaneous connect() calls on client', testSimultaneousConnectsOnClient);
				test('Test simultaneous disconnect() calls on client', testSimultaneousDisconnectsOnClient);
				test('Test simultaneous disconnect() and connect() calls on client', testSimultaneousDisconnectAndConnectOnClient);
			}
		};

		const runTests = async function(): Promise<void>
		{
			// Run normal tests.
			await runNormalTests();
		};

		// Run all tests.
		runTests();
	});
};

// Set up client request test using WebSockets
test('Should fallback', async () =>
{
	// Configure a secured web socket.
	const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumWebSocket, 50004, true);

	// Initialize an electrum client.
	const electrum = new ElectrumFallbackClient(clients, { rank: false });

	// Wait for the client to connect
	await electrum.connect();

	{
		// Perform the request according to the use case.
		// @ts-ignore
		const requestOutput = await electrum.request(...useCase.request.input);

		// Verify that the transaction hex matches expectations.
		expect(requestOutput).toEqual(useCase.request.output);
	}

	await electrum.clients[0].disconnect();

	{
		// Perform the request according to the use case.
		// @ts-ignore
		const requestOutput = await electrum.request(...useCase.request.input);

		// Verify that the transaction hex matches expectations.
		expect(requestOutput).toEqual(useCase.request.output);
	}

	await electrum.clients[1].disconnect();

	// no more healthy servers left
	{
		// Perform the request according to the use case.
		// @ts-ignore
		await expect(electrum.request(...useCase.request.input)).rejects.toThrow();
	}
});

// Set up client request test using WebSockets
test('Should subscribe with fallbacks', async () =>
{
	// Configure a secured web socket.
	const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumWebSocket, 50004, true);

	// Initialize an electrum client.
	const electrum = new ElectrumFallbackClient(clients, { rank: false });

	await electrum.clients[1].connect();

	await electrum.subscribe('blockchain.headers.subscribe');

	await electrum.clients[0].connect();

	// Wait for the client to connect
	await electrum.connect();

	await new Promise<void>((resolve) => setTimeout(() => resolve(), 200));

	expect(electrum.chainHeight).toBeGreaterThan(0);

	// check no throw
	await electrum.unsubscribe('blockchain.headers.subscribe');

	// check unsubscription worked and next attempt will throw
	await expect(electrum.unsubscribe('blockchain.headers.subscribe')).rejects.toThrow();

	await electrum.disconnect();
});

test('Should throw if clients array is empty', async () =>
{
	expect(() => new ElectrumFallbackClient([], { rank: false })).toThrow();
});

test('Should throw with duplicate clients', async () =>
{
	const clients = initClientsWithHostnames(['bch.imaginary.cash', 'bch.imaginary.cash']);

	// Initialize an electrum client.
	expect(() => new ElectrumFallbackClient(clients)).toThrow();
});

test('Should work with empty options', async () =>
{
	// Configure a secured web socket.
	const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumWebSocket, 50004, true);

	expect(() => new ElectrumFallbackClient(clients)).not.toThrow();
});

test('Should throw if all clients are offline', async () =>
{
	const clients = initClientsWithHostnames(['bch1.imaginary.cash', 'bch2.imaginary.cash']);

	// Initialize an electrum client.
	const clinet = new ElectrumFallbackClient(clients);

	await expect(clinet.connect()).rejects.toThrow();
});

test('Should get status', async () =>
{
	// Configure a secured web socket.
	const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumWebSocket, 50004, true);

	// Initialize an electrum client.
	const electrum = new ElectrumFallbackClient(clients);

	expect(electrum.status).toBe(ConnectionStatus.DISCONNECTED);

	// Wait for the client to connect
	await electrum.connect();

	expect(electrum.status).toBe(ConnectionStatus.CONNECTED);

	await electrum.disconnect();
});

test('Should get client identifier', async () =>
{
	// Configure a secured web socket.
	const clients: ElectrumClient<ElectrumClientEvents>[] = initClientsWithSockets(ElectrumWebSocket, 50004, true);

	// Initialize an electrum client.
	const electrum = new ElectrumFallbackClient(clients);

	expect(electrum.hostIdentifier).toContain('Fallback');
	expect(electrum.hostIdentifier).toContain('blackie.c3-soft.com');
	expect(electrum.hostIdentifier).toContain('bch.imaginary.cash:50004');
});

test('Should test utility initializer', async () =>
{
	const electrum = ElectrumFallbackClient.FromHostUrls(ElectrumWebSocket, ['wss://bch.imaginary.cash:50004', 'ws://blackie.c3-soft.com:50003'], { rank: true });
	expect(electrum).toBeInstanceOf(ElectrumFallbackClient);

	await expect(electrum.connect()).resolves.not.toThrow();

	await electrum.disconnect();
});
