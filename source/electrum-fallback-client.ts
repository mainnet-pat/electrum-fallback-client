import debug from '@electrum-cash/debug-logs';
import { ElectrumClientEvents, RPCParameter, RequestResponse, RPCNotification, ElectrumClient, ConnectionStatus, ElectrumSocket, ElectrumNetworkOptions } from '@electrum-cash/network';
import { EventEmitter } from 'eventemitter3';

export type RankOptions = {
  /**
   * The polling interval (in ms) at which the ranker should ping the RPC URL.
   * @default client.pollingInterval
   */
  interval?: number | undefined
  /**
   * Ping method to determine latency.
   */
  ping?: (parameters: {
    client: ElectrumClient<ElectrumClientEvents>
  }) => Promise<unknown> | undefined
  /**
   * The number of previous samples to perform ranking on.
   * @default 10
   */
  sampleCount?: number | undefined
  /**
   * Timeout when sampling transports.
   * @default 1_000
   */
  timeout?: number | undefined
  /**
   * Weights to apply to the scores. Weight values are proportional.
   */
  weights?:
    | {
        /**
         * The weight to apply to the latency score.
         * @default 0.3
         */
        latency?: number | undefined
        /**
         * The weight to apply to the stability score.
         * @default 0.7
         */
        stability?: number | undefined
      }
    | undefined
}

const pollingInterval = 4_000;

export type Score = [number, number, string];
export type Scores = Score[];

/**
 * List of events emitted by the ElectrumClient.
 * @event
 * @ignore
 */
export interface ElectrumFallbackClientEvents extends ElectrumClientEvents {
	/**
	 * Emitted when ranking scores update.
	 * @eventProperty
	 */
	'scores': Scores;
}

/**
 * High-level Electrum client that lets applications send requests and subscribe to notification events from a server.
 */
export class ElectrumFallbackClient<ElectrumEvents extends ElectrumFallbackClientEvents> extends EventEmitter<ElectrumFallbackClientEvents | ElectrumEvents> implements ElectrumFallbackClientEvents {
	/**
	 * The chain height of the blockchain indexed by the server.
	 * @remarks This is only available after a 'blockchain.headers.subscribe' call.
	 */
	public chainHeight: number;

	// Initialize an empty list of subscription metadata.
	private subscriptionMethods: Record<string, Set<string>> = {};

	public rank: boolean | RankOptions | undefined;
	private rankingAbortController: AbortController;
	public scores: Scores = [];

	get status(): ConnectionStatus {
		return this.clients.some(client => client.status === ConnectionStatus.CONNECTED) ? ConnectionStatus.CONNECTED : ConnectionStatus.DISCONNECTED;
	};

	get hostIdentifier(): string {
		return `FallbackClient [${this.clients.map(client => client.hostIdentifier).join(', ')}]`;
	};

	constructor(public clients: ElectrumClient<ElectrumEvents>[], { rank = false }: {
		/** Toggle to enable ranking, or rank options. */
		rank?: boolean | RankOptions | undefined
	} | undefined = {}) {
		if (clients.length === 0) {
			throw new Error('At least one ElectrumClient must be provided to ElectrumFallbackClient.');
		}

		super();
		this.rank = rank;

		// Check for duplicate clients by hostIdentifier
		const seen = new Set<string>();
		for (const client of clients) {
			if (seen.has(client.hostIdentifier)) {
				throw new Error(`Duplicate ElectrumClient with hostIdentifier '${client.hostIdentifier}' found.`);
			}
			seen.add(client.hostIdentifier);
		}
	}

	// convenience static function to create an ElectrumFallbackClient from a list of hosts and a socket class assuming default options
	// hossUrls: array of strings representing the Electrum server URLs (e.g. 'wss://electrum.example.com:50004')
	// Socket: class that implements the ElectrumSocket interface (e.g. ElectrumWebSocket or ElectrumTcpSocket)
	// options: optional configuration object for the ElectrumFallbackClient
	// socket type should correspond to the scheme (e.g. ElectrumWebSocket for 'wss' or 'ws', ElectrumTcpSocket for 'tcp_tls' or 'tcp')
	static FromHostUrls = (Socket: new (host: string, port: number, encrypted: boolean) => ElectrumSocket, hostUrls: string[], options: {
		applicationName?: string;
		protocolVersion?: string;
		rank?: boolean | RankOptions;
		clientOptions?: ElectrumNetworkOptions;
	}) => {
		const clients: ElectrumClient<ElectrumClientEvents>[] = hostUrls.map((givenUrl) => {
			// Parse the URL.
			const url = new URL(givenUrl);
			const port = parseInt(url.port || (url.protocol === 'wss:' || url.protocol === 'https:' ? "443" : "80"));
			const encrypted = url.protocol === 'wss:' || url.protocol === 'tcp_tls:' || url.protocol === 'tcp+tls:';

			// Configure an encrypted socket.
			const socket = new Socket(url.hostname, port, encrypted);

			// Initialize an electrum client.
			const electrumClient = new ElectrumClient(options?.applicationName ?? "ElectrumFallbackClient", options?.protocolVersion ?? "1.5", socket, options.clientOptions);
			return electrumClient;
		});

		// Initialize an electrum client.
		const electrumClient = new ElectrumFallbackClient(clients, { rank: options?.rank });
		return electrumClient;
	};

	/**
	 * Connects to the remote servers.
	 *
	 * @throws {Error} if the socket connection fails.
	 * @returns a promise resolving when the connection is established.
	 */
	async connect(): Promise<void> {
		if(this.status === ConnectionStatus.CONNECTED)
		{
			return;
		}

		this.emit('connecting');
		let connected = false;

		if (!this.rank) {
			for (const [index, client] of this.clients.entries()) {
				try {
					await client.connect();
					connected = true;

					// Connect the rest of the clients asynchronously in the background
					const remainingClients = this.clients.slice(index + 1);
					Promise.allSettled(remainingClients.map(c => c.connect()));

					// Move the connected client to the beginning of the list
					if (this.clients[0] !== client) {
						this.clients = [client, ...this.clients.filter(c => c !== client)];
					}
					break;
				} catch {
					// Try the next client.
				}
			}
		} else {
			try {
				const promises = this.clients.map(client =>
					client.connect().then(() => client)
				);
				const client = await Promise.any(promises);
				// Move the connected client to the beginning of the list
				if (this.clients[0] !== client) {
					this.clients = [client, ...this.clients.filter(c => c !== client)];
				}
				connected = true;

				// wait for the rest of the clients to connect in the background, then start ranking
				Promise.allSettled(promises).then(() => {
					this.rankingAbortController = new AbortController();
					const rankOptions = (typeof this.rank === 'object' ? this.rank : {}) as RankOptions;
					this.rankClients({
						interval: rankOptions.interval ?? pollingInterval,
						onClients: (clients_) => (this.clients = clients_ as any),
						onScores: (scores_) => {
							this.scores = scores_;
							this.emit('scores', scores_ as any);
						},
						ping: rankOptions.ping,
						sampleCount: rankOptions.sampleCount,
						timeout: rankOptions.timeout,
						clients: this.clients,
						weights: rankOptions.weights,
						abortController: this.rankingAbortController,
					});
				});
			} catch {
				// All clients failed to connect.
			}
		}

		if (!connected) {
			throw new Error('Failed to connect to any underlying Electrum client.');
		}
		this.emit('connected');
	}

	/**
	 * Disconnects from the remote server and removes all event listeners/subscriptions and open requests.
	 *
	 * @param force               - disconnect even if the connection has not been fully established yet.
	 * @param retainSubscriptions - retain subscription data so they will be restored on reconnection.
	 *
	 * @returns true if successfully disconnected, or false if there was no connection.
	 */
	async disconnect(force: boolean = false, retainSubscriptions: boolean = false): Promise<boolean>
	{
		this.emit('disconnecting');
		this.rankingAbortController?.abort();

		await Promise.allSettled(
			this.clients.map(client => client.disconnect(force, retainSubscriptions))
		);

		this.emit('disconnected');

		return true;
	}

	// Ranks the provided clients according to stability and latency.
	public async rankClients({
		interval = 4_000,
		onClients,
		onScores,
		ping,
		sampleCount = 10,
		timeout = 1_000,
		clients,
		weights = {},
		abortController,
	}: {
		interval: RankOptions['interval']
		onClients: (clients: readonly ElectrumClient<ElectrumEvents>[]) => void
		onScores?: (scores: Scores) => void
		ping?: RankOptions['ping'] | undefined
		sampleCount?: RankOptions['sampleCount'] | undefined
		timeout?: RankOptions['timeout'] | undefined
		clients: readonly ElectrumClient<ElectrumEvents>[]
		weights?: RankOptions['weights'] | undefined
		abortController?: AbortController
	}) {
		const { stability: stabilityWeight = 0.7, latency: latencyWeight = 0.3 } = weights

		type SampleData = { latency: number; success: number }
		type Sample = SampleData[]
		const samples: Sample[] = []

		while (!abortController?.signal.aborted) {
			// 1. Take a sample from each Transport.
			const sample: Sample = await Promise.all(
				clients.map(async (client) => {
					const client_ = client;

					const start = Date.now()
					let end: number
					let success: number
					try {
						await (
							Promise.race([
									ping ? ping({ client: client_ }) : client_.request('server.ping'),
									new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), timeout))
								]))
						success = 1
					} catch (err) {
						debug.warning(`Ping failed for client ${client_.hostIdentifier}`, err);
						success = 0
					} finally {
						end = Date.now()
					}
					const latency = end - start
					return { latency, success }
				}),
			)

			// 2. Store the sample. If we have more than `sampleCount` samples, remove
			// the oldest sample.
			samples.push(sample)
			if (samples.length > sampleCount) samples.shift()

			// 3. Calculate the max latency from samples.
			const maxLatency = Math.max(
				...samples.map((sample) =>
					Math.max(...sample.map(({ latency }) => latency)),
				),
			)

			// 4. Calculate the score for each Transport.
			const scores = clients
				.map((client, i) => {
					const latencies = samples.map((sample) => sample[i].latency)
					const meanLatency =
						latencies.reduce((acc, latency) => acc + latency, 0) /
						latencies.length
					const latencyScore = 1 - meanLatency / maxLatency

					const successes = samples.map((sample) => sample[i].success)
					const stabilityScore =
						successes.reduce((acc, success) => acc + success, 0) /
						successes.length

					if (stabilityScore === 0) return [0, i, client.hostIdentifier] as Score
					return [
						latencyWeight * latencyScore + stabilityWeight * stabilityScore,
						i,
						client.hostIdentifier,
					] as Score
				})
				.sort((a, b) => b[0] - a[0])

			onScores?.(scores)

			// 5. Sort the Transports by score.
			onClients(scores.map(([, i]) => clients[i]))

			// 6. Wait, and then rank again.
			if (abortController?.signal.aborted) break
			await new Promise((res) => setTimeout(res, interval))
		}
	}


	/**
	 * Calls a method on the remote server with the supplied parameters.
	 *
	 * @param method     - name of the method to call.
	 * @param parameters - one or more parameters for the method.
	 *
	 * @throws {Error} if the client is disconnected.
	 * @returns a promise that resolves with the result of the method or an Error.
	 */
	async request(method: string, ...parameters: RPCParameter[]): Promise<Error | RequestResponse>
	{
		const [response] = await this.requestInternal(method, ...parameters);
		return response;
	}

	/**
	 * Calls a method on the remote server with the supplied parameters.
	 *
	 * @param method     - name of the method to call.
	 * @param parameters - one or more parameters for the method.
	 *
	 * @throws {Error} if the client is disconnected.
	 * @returns a promise that resolves with the result of the method or an Error.
	 */
	private async requestInternal(method: string, ...parameters: RPCParameter[]): Promise<[Error | RequestResponse, ElectrumClient<ElectrumEvents>]>
	{
		const fetch = async (i = 0): Promise<any> => {
			const client = this.clients[i];
			try {
				const response = await client.request(
					method,
					...parameters,
				)

				return [response, client]
			} catch (err) {
				// If we've reached the end of the fallbacks, throw the error.
				if (i === this.clients.length - 1) throw err

				// Otherwise, try the next fallback.
				return fetch(i + 1)
			}
		}
		return fetch()
	}

	/**
	 * Calls a method on the remote server with the supplied parameters.
	 *
	 * @param method     - name of the method to call.
	 * @param parameters - one or more parameters for the method.
	 *
	 * @throws {Error} if the client is disconnected.
	 * @returns a promise that resolves with the result of the method or an Error.
	 */
	private async requestClient(client, method: string, ...parameters: RPCParameter[]): Promise<Error | RequestResponse>
	{
    return client.request(
			method,
			...parameters,
		);
	}

	/**
	 * Subscribes to the method and payload at the server.
	 *
	 * @remarks the response for the subscription request is issued as a notification event.
	 *
	 * @param method     - one of the subscribable methods the server supports.
	 * @param parameters - one or more parameters for the method.
	 *
	 * @throws {Error} if the client is disconnected.
	 * @returns a promise resolving when the subscription is established.
	 */
	async subscribe(method: string, ...parameters: RPCParameter[]): Promise<void>
	{
		// Send initial subscription request.
		const [requestData, client] = await this.requestInternal(method, ...parameters);

		// If the request failed, throw it as an error.
		if(requestData instanceof Error)
		{
			throw(requestData);
		}

		const key = `${client.hostIdentifier}--${method}`;

		// Initialize an empty list of subscription payloads, if needed.
		if(!this.subscriptionMethods[key])
		{
			this.subscriptionMethods[key] = new Set<string>();
		}

		// Store the subscription parameters to track what data we have subscribed to.
		this.subscriptionMethods[key].add(JSON.stringify(parameters));

		// If the request returned more than one data point..
		if(Array.isArray(requestData))
		{
			// .. throw an error, as this breaks our expectation for subscriptions.
			throw(new Error('Subscription request returned an more than one data point.'));
		}

		// Construct a notification structure to package the initial result as a notification.
		const notification: RPCNotification =
		{
			jsonrpc: '2.0',
			method: method,
			params: [ ...parameters, requestData ],
		};

		// Manually emit an event for the initial response.
		this.emit('notification', notification);

		client.on('notification', (notification: RPCNotification) => {
			this.emit('notification', notification);
		});

		// Try to update the chain height.
		this.updateChainHeightFromHeadersNotifications(notification);
	}

	/**
	 * Unsubscribes to the method at the server and removes any callback functions
	 * when there are no more subscriptions for the method.
	 *
	 * @param method     - a previously subscribed to method.
	 * @param parameters - one or more parameters for the method.
	 *
	 * @throws {Error} if no subscriptions exist for the combination of the provided `method` and `parameters.
	 * @throws {Error} if the client is disconnected.
	 * @returns a promise resolving when the subscription is removed.
	 */
	async unsubscribe(method: string, ...parameters: RPCParameter[]): Promise<void>
	{
		const keys = Object.keys(this.subscriptionMethods);
		const clientKey = keys.find((key) => key.endsWith(`--${method}`) && this.subscriptionMethods[key].has(JSON.stringify(parameters)));
		if(!clientKey)
		{
			throw(new Error(`Cannot unsubscribe from '${method}' since the method has no subscriptions.`));
		}
		const clientHost = clientKey.split('--')[0];

		// Pack up the parameters as a long string.
		const subscriptionParameters = JSON.stringify(parameters);

		// Remove this specific subscription payload from internal tracking.
		this.subscriptionMethods[clientKey].delete(subscriptionParameters);

		// Send unsubscription request to the server
		// NOTE: As a convenience we allow users to define the method as the subscribe or unsubscribe version.
		await this.requestClient(this.clients.find(client => client.hostIdentifier === clientHost), method.replace('.subscribe', '.unsubscribe'), ...parameters);

		// Write a log message.
		debug.client(`Unsubscribed from '${String(method)}' for the '${subscriptionParameters}' parameters.`);
	}

	/**
	 * Checks if the provided message is a response to a headers subscription,
	 * and if so updates the locally stored chain height value for this client.
	 *
	 * @ignore
	 */
	async updateChainHeightFromHeadersNotifications(message): Promise<void>
	{
		// If the message is a notification for a new chain height..
		if(message.method === 'blockchain.headers.subscribe')
		{
			// ..also store the updated chain height locally.
			this.chainHeight = Math.max(this.chainHeight ?? 0, message.params[0].height);
		}
	}

	// Add magic glue that makes typedoc happy so that we can have the events listed on the class.
	public readonly connecting: [];
	public readonly connected: [];
	public readonly disconnecting: [];
	public readonly disconnected: [];
	public readonly reconnecting: [];
	public readonly notification: [ RPCNotification ];
	public readonly error: [ Error ];
}

// Export the client.
export default ElectrumFallbackClient;
