/// <reference types="spotify-api" />

import {
	CompanionVariableDefinition,
	InstanceBase,
	InstanceStatus,
	runEntrypoint,
	SomeCompanionConfigField,
} from '@companion-module/base'
import PQueue from 'p-queue'
import { GetConfigFields, DeviceConfig, DEFAULT_CONFIG, ensureRequiredConfigIsDefined } from './config.js'
import { FeedbackId, GetFeedbacksList } from './feedback.js'
import { DoAction, GetActionsList } from './actions.js'
import { GetPresetsList } from './presets.js'
import { SpotifyPlaybackState, SpotifyPlaylistInfo, SpotifyState } from './state.js'
import { SpotifyInstanceBase } from './types.js'
import { UpgradeScripts } from './upgrades.js'
import { authorizationCodeGrant, GenerateAuthorizeUrl, refreshAccessToken } from './api/auth.js'
import { getMyCurrentPlaybackState } from './api/playback.js'
import { getMyDevices } from './api/device.js'
import { getImageBuffer, getMyPlaylists, PLAYLIST_PAGE_LIMIT, SimplifiedPlaylistResponse } from './api/library.js'
import { formatApiError, isInvalidGrantError, RequestOptionsBase } from './api/util.js'

const AUTH_SCOPES = [
	'user-read-playback-state',
	'user-modify-playback-state',
	'user-read-currently-playing',
	'streaming',
	'app-remote-control',
	'playlist-read-collaborative',
	'playlist-read-private',
	'user-library-read',
	'user-top-read',
	'user-read-playback-position',
]

/** Check the device list on every Nth playback poll, to stay well clear of the API rate limit */
const DEVICE_POLL_EVERY = 5
/** How often the playlist library is fetched again without being asked */
const PLAYLIST_REFRESH_MS = 10 * 60 * 1000
/** Stop paging the library after this many playlists */
const MAX_PLAYLISTS = 1000
/** Cover art is skipped above this size, so one huge upload cannot bloat every button render */
const MAX_COVER_ART_BYTES = 256 * 1024
/** Covers at least this wide look sharp on a 72px button; smaller ones are only used as a fallback */
const MIN_COVER_ART_WIDTH = 60

function pickCoverImage(images: SpotifyApi.ImageObject[] | null | undefined): string | null {
	if (!images || images.length === 0) return null
	// Spotify lists the largest first; custom uploads come back as a single image with no size
	const sized = images.filter((i) => typeof i.width === 'number' && i.width >= MIN_COVER_ART_WIDTH)
	if (sized.length === 0) return images[images.length - 1].url
	sized.sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
	// Prefer the smallest image that is still at least twice the button size, for a clean downscale
	return (sized.find((i) => (i.width ?? 0) >= 144) ?? sized[sized.length - 1]).url
}

function toPlaylistInfo(raw: SimplifiedPlaylistResponse): SpotifyPlaylistInfo {
	const total = raw.items?.total ?? raw.tracks?.total
	return {
		id: raw.id,
		name: raw.name,
		uri: raw.uri,
		ownerName: raw.owner?.display_name ?? null,
		imageUrl: pickCoverImage(raw.images),
		trackCount: typeof total === 'number' ? total : null,
	}
}

class SpotifyInstance extends InstanceBase<DeviceConfig> implements SpotifyInstanceBase {
	public config: DeviceConfig

	private accessToken: string | null = null

	private pollTimer: NodeJS.Timeout | undefined

	private activeVolumeAbort: AbortController | null = null

	private readonly state: SpotifyState
	private readonly pollQueue = new PQueue({ concurrency: 1 })

	private pollCount = 0
	private lastPlaylistRefresh = 0
	private playlistRefresh: Promise<void> | null = null
	private readonly coverArtCache = new Map<string, Promise<string | null>>()

	constructor(internal: unknown) {
		super(internal)

		this.state = { playbackState: null, playlists: null, playlistPage: 0, devices: null }

		this.config = { ...DEFAULT_CONFIG }
	}

	premuteVolume: number = 50

	public async checkIfApiErrorShouldRetry(err: any): Promise<boolean> {
		// Error Code 401 represents out of date token
		if ('statusCode' in err && err.statusCode == '401') {
			return this.performTokenRefresh()
		} else {
			this.log('debug', `Something went wrong with an API Call: ${formatApiError(err)}`)

			return false
		}
	}

	/**
	 * Exchange the stored refresh token for a fresh access token.
	 * Persists a rotated refresh token if Spotify returns one, and if the refresh token has
	 * expired or been revoked (Spotify now enforces a 6 month lifetime) it is discarded and the
	 * user is prompted to re-authorize rather than the module retrying forever.
	 * @returns true if a new access token was obtained
	 */
	private async performTokenRefresh(): Promise<boolean> {
		if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
			this.log('debug', `Missing properties required to refresh access token`)
			return false
		}

		try {
			const data = await refreshAccessToken(this.config.clientId, this.config.clientSecret, this.config.refreshToken)
			if (data.body?.access_token) {
				// Save the new token
				this.accessToken = data.body.access_token

				// Spotify may rotate the refresh token - persist the new one so the next refresh works
				if (data.body.refresh_token && data.body.refresh_token !== this.config.refreshToken) {
					this.config.refreshToken = data.body.refresh_token
					this.saveConfig(this.config)
				}

				this.updateStatus(InstanceStatus.Ok)
				return true
			}

			this.log('debug', `No access token in refresh response`)
			this.accessToken = null
			this.updateStatus(InstanceStatus.Connecting)
			return false
		} catch (err) {
			// Clear the stale token
			this.accessToken = null

			if (isInvalidGrantError(err)) {
				// The refresh token is expired or revoked - it can never succeed again.
				// Discard it and send the user back through the authorization flow.
				this.log('warn', `Refresh token is no longer valid, re-authorization required: ${formatApiError(err)}`)
				delete this.config.refreshToken
				this.regenerateAuthUrl('Refresh token expired - please re-authorize using the Auth URL')
			} else {
				// Likely a transient/network error - keep the refresh token and try again later
				this.log('warn', `Failed to refresh access token: ${formatApiError(err)}`)
				this.updateStatus(InstanceStatus.Connecting)
			}
			return false
		}
	}

	/**
	 * (Re)generate the authorization URL from the current config and surface it to the user,
	 * putting the module into a BadConfig state that explains what to do next.
	 */
	private regenerateAuthUrl(statusMessage: string): void {
		if (this.config.clientId && this.config.redirectUri) {
			this.config.authURL = GenerateAuthorizeUrl(
				this.config.clientId,
				this.config.redirectUri,
				AUTH_SCOPES,
				'',
			).toString()
			this.saveConfig(this.config)

			this.log('info', `Please visit the following URL to authorize the module: ${this.config.authURL}`)
		}

		this.updateStatus(InstanceStatus.BadConfig, statusMessage)
	}

	public getRequestOptionsBase(): RequestOptionsBase | null {
		if (this.accessToken) {
			return { accessToken: this.accessToken }
		} else {
			return null
		}
	}

	public startVolumeFade(): AbortSignal {
		this.activeVolumeAbort?.abort()
		this.activeVolumeAbort = new AbortController()
		return this.activeVolumeAbort.signal
	}

	async configUpdated(config: DeviceConfig): Promise<void> {
		this.config = config
		if (ensureRequiredConfigIsDefined(this.config)) {
			this.saveConfig(this.config)
		}

		this.setupOrRefreshAuthentication(true)

		this.initActions()
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()
		this.changePlaylistPage(0)
		this.checkFeedbacks()
	}

	override updateStatus(status: InstanceStatus, message?: string | null): void {
		// Override the implementation so that when the auth checks say 'ok' we can hijack it and report a status based on the selected device
		if (status === InstanceStatus.Ok && !this.config.deviceId) {
			super.updateStatus(InstanceStatus.BadConfig, 'No playout device selected')
		} else {
			super.updateStatus(status, message)
		}
	}

	private setupOrRefreshAuthentication(clearToken = false) {
		if (clearToken) {
			// Clear the access token each time to ensure it is correct
			this.accessToken = null
		}

		if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
			this.updateStatus(InstanceStatus.BadConfig)

			// Missing required fields
		} else if (this.accessToken) {
			this.updateStatus(InstanceStatus.Ok)

			// All ok
		} else if (this.config.code) {
			this.updateStatus(InstanceStatus.Connecting)

			// Fetch then clear the code
			const code = this.config.code.trim()
			delete this.config.code
			this.saveConfig(this.config)

			// convert code to access token
			authorizationCodeGrant(this.config.clientId, this.config.clientSecret, this.config.redirectUri, code)
				.then((data) => {
					if (data.body?.access_token) {
						this.accessToken = data.body.access_token

						if (data.body.refresh_token) {
							this.config.refreshToken = data.body.refresh_token
						} else {
							delete this.config.refreshToken
						}
						this.saveConfig(this.config)

						this.updateStatus(InstanceStatus.Ok)
					} else {
						this.accessToken = null
						this.log('warn', `Authorization response did not contain an access token`)

						// The approval code has been consumed, offer a fresh one to retry with
						this.regenerateAuthUrl('Authorization failed - please try again using the Auth URL')
					}
				})
				.catch((err) => {
					const msg = formatApiError(err)
					this.log('warn', `Failed to get access token: ${msg}`)

					// The approval code is single-use and now consumed, so generate a fresh auth URL
					// to let the user retry instead of leaving them stuck with a silently cleared field.
					this.regenerateAuthUrl(`Authorization failed: ${msg}`)
				})
		} else if (this.config.refreshToken) {
			this.updateStatus(InstanceStatus.Connecting)

			// Perform refresh
			void this.performTokenRefresh()
		} else {
			// Needs manual intervention
			this.regenerateAuthUrl('Please authorize the module using the Auth URL')
		}
	}

	async init(config: DeviceConfig): Promise<void> {
		this.config = config
		if (ensureRequiredConfigIsDefined(this.config)) {
			this.saveConfig(this.config)
		}

		this.updateStatus(InstanceStatus.Connecting)

		this.setupOrRefreshAuthentication(true)

		if (!this.pollTimer && this.config.pollInterval) {
			this.pollTimer = setInterval(() => this.queuePoll(), this.config.pollInterval * 1000) // Check every 3 seconds. This leaves a bit of headroom before we hit the daily api limit
		}

		this.initActions()
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()
		this.updatePlaylistBrowserVariables()
	}

	async destroy(): Promise<void> {
		this.log('debug', 'destroy')

		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			delete this.pollTimer
		}

		if (this.activeVolumeAbort) {
			this.activeVolumeAbort.abort()
			this.activeVolumeAbort = null
		}
	}
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields(this.state.playbackState?.deviceInfo?.id, this.state.devices, this.config.deviceId)
	}

	public async refreshPlaylists(): Promise<void> {
		// Share one fetch between overlapping callers, such as a button press during the timed refresh
		if (!this.playlistRefresh) {
			this.playlistRefresh = this.doRefreshPlaylists().finally(() => {
				this.playlistRefresh = null
			})
		}
		return this.playlistRefresh
	}

	private async doRefreshPlaylists(attempt = 0): Promise<void> {
		const reqOptions = this.getRequestOptionsBase()
		if (!reqOptions) return

		try {
			const playlists: SpotifyPlaylistInfo[] = []
			let offset = 0
			while (offset < MAX_PLAYLISTS) {
				const page = await getMyPlaylists(reqOptions, offset)
				const items = page.body?.items ?? []
				for (const item of items) {
					// Spotify returns null entries for playlists that can no longer be read
					if (item?.id) playlists.push(toPlaylistInfo(item))
				}
				if (!page.body?.next || items.length < PLAYLIST_PAGE_LIMIT) break
				offset += PLAYLIST_PAGE_LIMIT
			}

			this.lastPlaylistRefresh = Date.now()
			this.state.playlists = playlists
			this.log('debug', `Loaded ${playlists.length} playlists`)

			this.initActions()
			this.initFeedbacks()
			this.initPresets()
			this.changePlaylistPage(0)
		} catch (err) {
			const retry = await this.checkIfApiErrorShouldRetry(err)
			if (retry && attempt < 2) return this.doRefreshPlaylists(attempt + 1)

			// Try again on a later poll rather than hammering a failing API
			this.lastPlaylistRefresh = Date.now()
			this.log('warn', `Failed to load playlists: ${formatApiError(err)}`)
		}
	}

	private get playlistPageCount(): number {
		const count = this.state.playlists?.length ?? 0
		return Math.max(1, Math.ceil(count / this.config.playlistSlots))
	}

	public changePlaylistPage(delta: number | 'first'): void {
		const pageCount = this.playlistPageCount
		const target = delta === 'first' ? 0 : this.state.playlistPage + delta
		// Wrap at either end, so a single "next" button walks the whole library
		this.state.playlistPage = ((target % pageCount) + pageCount) % pageCount

		this.updatePlaylistBrowserVariables()
		this.checkFeedbacks(FeedbackId.PlaylistSlotArt, FeedbackId.PlaylistSlotIsPlaying)
	}

	public getPlaylistInSlot(slot: number): SpotifyPlaylistInfo | null {
		if (!Number.isInteger(slot) || slot < 1 || slot > this.config.playlistSlots) return null
		const index = this.state.playlistPage * this.config.playlistSlots + (slot - 1)
		return this.state.playlists?.[index] ?? null
	}

	public findPlaylist(idOrUri: string): SpotifyPlaylistInfo | null {
		const id = idOrUri.startsWith('spotify:') ? idOrUri.substring(idOrUri.lastIndexOf(':') + 1) : idOrUri
		return this.state.playlists?.find((p) => p.id === id) ?? null
	}

	public async getCoverArt(url: string): Promise<string | null> {
		let cached = this.coverArtCache.get(url)
		if (!cached) {
			cached = getImageBuffer(url)
				.then(({ buffer, contentType }) => {
					if (buffer.length > MAX_COVER_ART_BYTES) {
						this.log('debug', `Skipping cover art over ${MAX_COVER_ART_BYTES} bytes: ${url}`)
						return null
					}
					const mime = contentType?.startsWith('image/') ? contentType : 'image/jpeg'
					return `data:${mime};base64,${buffer.toString('base64')}`
				})
				.catch((err) => {
					this.log('debug', `Failed to load cover art: ${formatApiError(err)}`)
					// Forget the failure so the next render tries again
					this.coverArtCache.delete(url)
					return null
				})
			this.coverArtCache.set(url, cached)
		}
		return cached
	}

	private updatePlaylistBrowserVariables(): void {
		const values: { [variableId: string]: string | number | undefined } = {}
		for (let slot = 1; slot <= this.config.playlistSlots; slot++) {
			values[`playlistSlot${slot}Name`] = this.getPlaylistInSlot(slot)?.name ?? ''
		}
		values['playlistCount'] = this.state.playlists?.length ?? 0
		values['playlistPage'] = this.state.playlistPage + 1
		values['playlistPageCount'] = this.playlistPageCount
		values['playlistPageLabel'] = `${this.state.playlistPage + 1}/${this.playlistPageCount}`
		this.setVariableValues(values)
	}

	private async doPollDevices(): Promise<void> {
		const reqOptions = this.getRequestOptionsBase()
		if (!reqOptions) return

		try {
			const data = await getMyDevices(reqOptions)
			this.state.devices = (data.body?.devices ?? [])
				.filter((d): d is SpotifyApi.UserDevice & { id: string } => !!d.id)
				.map((d) => ({ id: d.id, name: d.name, type: d.type, isActive: d.is_active }))
		} catch (err) {
			// Leave the last known list in place; a single failed poll should not raise a warning
			this.log('debug', `Device poll failed: ${formatApiError(err)}`)
			return
		}

		const playbackDevice = this.state.devices.find((d) => d.id === this.config.deviceId)
		this.setVariableValues({
			playbackDeviceName: playbackDevice?.name ?? '',
			playbackDeviceOnline: !!playbackDevice,
		})
		this.checkFeedbacks(FeedbackId.PlaybackDeviceOffline, FeedbackId.PlayingOnAnotherDevice)
	}

	private initPresets() {
		this.setPresetDefinitions(GetPresetsList(this.label, this.state.playlists, this.config.playlistSlots))
	}
	private initActions() {
		const executeActionWrapper = async (fcn: DoAction) => {
			// Verify the api client is configured
			if (this.canPollOrPost()) {
				await fcn(this, this.config.deviceId || null)
					.catch((e) => {
						// console.log(e)
						this.log('error', `Execute action failed: ${formatApiError(e)}`)
					})
					.then(() => {
						// Do a poll asap, to catch the changes
						this.queuePoll()
					})
			}
		}

		const actions = GetActionsList(executeActionWrapper, this.state.playlists)
		this.setActionDefinitions(actions)
	}
	// Set up Feedbacks
	private initFeedbacks() {
		const feedbacks = GetFeedbacksList(this, () => this.state)
		this.setFeedbackDefinitions(feedbacks)
	}
	private initVariables() {
		const variables: CompanionVariableDefinition[] = [
			{ variableId: 'songName', name: 'Current Song Name' },
			{ variableId: 'albumName', name: 'Current Album Name' },
			{ variableId: 'artistName', name: 'Current Artist Name' },
			{ variableId: 'isPlaying', name: 'Is Playback Active' },
			{ variableId: 'isPlayingIcon', name: 'Playback Icon' },
			{ variableId: 'isShuffle', name: 'Is Shuffle Enabled' },
			{ variableId: 'repeat', name: 'Is Repeat Enabled' },
			{ variableId: 'currentContext', name: 'Current Context ID' },
			{ variableId: 'songPercentage', name: 'Percentage of the current song completed' },
			{ variableId: 'songProgressSeconds', name: 'Progress of the current song in seconds' },
			{ variableId: 'songDurationSeconds', name: 'Duration of the current song in seconds' },
			{ variableId: 'songTimeRemaining', name: 'Time remaining in song (pretty formatted HH:MM:SS)' },
			{ variableId: 'songTimeRemainingHours', name: 'Hours remaining in song (zero padded)' },
			{ variableId: 'songTimeRemainingMinutes', name: 'Minutes remaining in song (zero padded)' },
			{ variableId: 'songTimeRemainingSeconds', name: 'Seconds remaining in song (zero padded)' },
			{ variableId: 'volume', name: 'Current Volume' },
			{
				variableId: 'currentAlbumArt',
				name: 'Currently playing album artwork. Use the generic http module to display this on a button',
			},
			{ variableId: 'deviceName', name: 'Current device name' },
			{ variableId: 'deviceId', name: 'Current device id' },
			{ variableId: 'premuteVolume', name: 'Volume before mute' },
			{ variableId: 'playbackDeviceName', name: 'Name of the playback device chosen in the settings' },
			{ variableId: 'playbackDeviceOnline', name: 'Is the playback device online in Spotify' },
			{ variableId: 'playlistCount', name: 'Number of playlists in your library' },
			{ variableId: 'playlistPage', name: 'Playlist browser page number' },
			{ variableId: 'playlistPageCount', name: 'Playlist browser page count' },
			{ variableId: 'playlistPageLabel', name: 'Playlist browser page, as 1/4' },
		]
		for (let slot = 1; slot <= this.config.playlistSlots; slot++) {
			variables.push({ variableId: `playlistSlot${slot}Name`, name: `Playlist browser slot ${slot} name` })
		}

		this.setVariableDefinitions(variables)
	}

	private canPollOrPost(): boolean {
		return !!this.accessToken
	}
	public queuePoll(): void {
		if (this.pollQueue.size > 1) {
			this.log('debug', `Poll queue overflow`)
		} else {
			this.log('debug', `queue poll`)
			this.pollQueue
				.add(async () => {
					// If everything is populated we can do the poll
					if (this.canPollOrPost()) {
						try {
							await this.doPollPlaybackState()

							if (this.pollCount++ % DEVICE_POLL_EVERY === 0) await this.doPollDevices()

							if (Date.now() - this.lastPlaylistRefresh > PLAYLIST_REFRESH_MS) await this.refreshPlaylists()
						} catch (e: any) {
							this.log('debug', `Poll failed: ${e.toString()}`)
						}
					} else {
						this.updateStatus(InstanceStatus.BadConfig)

						this.setupOrRefreshAuthentication(false)
					}
				})
				.catch((e) => {
					this.log('debug', `Failed to queue poll: ${e.toString()}`)
				})
		}
	}

	private async doPollPlaybackState() {
		const reqOptions = this.getRequestOptionsBase()
		if (!reqOptions) return
		try {
			const data = await getMyCurrentPlaybackState(reqOptions)

			// Transform the library state into a minimal state that we want to track
			let newState: SpotifyPlaybackState | null = null
			if (data.body) {
				newState = {
					isPlaying: !!data.body.is_playing,
					isShuffle: !!data.body.shuffle_state,
					repeatState: data.body.repeat_state,
					currentContext: data.body.context && data.body.context.uri.split(':')[2],
					trackProgressMs: data.body.progress_ms ?? 0,
					trackInfo: null,
					deviceInfo: null,
				}

				// If an individual track is playing then context is null from Spotify API
				// If the current context is null, but a track is playing, then set the context to the track uri
				// This allows feedbacks to be triggered when an track is playing
				if (newState.currentContext === null && data.body.currently_playing_type === 'track' && data.body.item) {
					newState.currentContext = data.body.item.uri.split(':')[2]
				}

				if (data.body.item) {
					newState.trackInfo = {
						durationMs: data.body.item.duration_ms,
						name: data.body.item.name,
						artistName: null,
						albumName: null,
						albumImageUrl: null,
					}

					if ('artists' in data.body.item) {
						const rawArtists = data.body.item.artists
						newState.trackInfo.artistName = rawArtists.map((a) => a.name).join(', ')
					}

					if ('album' in data.body.item) {
						const rawAlbum = data.body.item.album
						newState.trackInfo.albumName = rawAlbum.name

						if (rawAlbum.images.length > 0) newState.trackInfo.albumImageUrl = rawAlbum.images[0].url
					}
				}

				if (data.body.device) {
					newState.deviceInfo = {
						id: data.body.device.id,
						name: data.body.device.name,

						volumePercent: data.body.device.volume_percent,
					}
				}
			}

			// Diff the state and inform companion of anything that changed
			this.diffAndSavePlaybackState(newState)
			this.updateStatus(InstanceStatus.Ok)
		} catch (err) {
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Failed to query Api')

			const retry = await this.checkIfApiErrorShouldRetry(err)
			if (retry) {
				this.queuePoll()
			} else {
				// clear the playback state, as we don't know what is going on..
				this.diffAndSavePlaybackState(null)
			}
		}
	}

	private diffAndSavePlaybackState(newState: SpotifyPlaybackState | null) {
		const oldState = this.state.playbackState
		this.state.playbackState = newState

		// console.log('NEW STATE', JSON.stringify(newState))
		const forceUpdate = !oldState && !!newState

		// Collect updates for batch saving
		const invalidatedFeedbacks: FeedbackId[] = []
		const variableUpdates: { [variableId: string]: string | number | boolean | undefined } = {} // TODO - type of this
		if (forceUpdate || oldState?.isPlaying !== newState?.isPlaying) {
			variableUpdates['isPlaying'] = !!newState?.isPlaying
			variableUpdates['isPlayingIcon'] = newState?.isPlaying ? '\u23F5' : '\u23F9'

			invalidatedFeedbacks.push(FeedbackId.IsPlaying, FeedbackId.PlayingOnAnotherDevice)
		}
		if (forceUpdate || oldState?.isShuffle !== newState?.isShuffle) {
			invalidatedFeedbacks.push(FeedbackId.IsShuffle)
			variableUpdates['isShuffle'] = !!newState?.isShuffle
		}
		if (forceUpdate || oldState?.repeatState !== newState?.repeatState) {
			invalidatedFeedbacks.push(FeedbackId.IsRepeat)
			variableUpdates['repeat'] = newState?.repeatState ?? 'off'
		}
		if (forceUpdate || oldState?.currentContext !== newState?.currentContext) {
			this.checkFeedbacks(FeedbackId.CurrentContext, FeedbackId.PlaylistIsPlaying, FeedbackId.PlaylistSlotIsPlaying)
			variableUpdates['currentContext'] = newState?.currentContext ?? ''
		}

		// Track info
		if (forceUpdate || oldState?.trackInfo?.artistName !== newState?.trackInfo?.artistName) {
			variableUpdates['artistName'] = newState?.trackInfo?.artistName ?? ''
		}
		if (forceUpdate || oldState?.trackInfo?.name !== newState?.trackInfo?.name) {
			variableUpdates['songName'] = newState?.trackInfo?.name ?? ''
		}
		if (forceUpdate || oldState?.trackInfo?.albumName !== newState?.trackInfo?.albumName) {
			variableUpdates['albumName'] = newState?.trackInfo?.albumName ?? ''
		}
		if (forceUpdate || oldState?.trackInfo?.albumImageUrl !== newState?.trackInfo?.albumImageUrl) {
			variableUpdates['currentAlbumArt'] = newState?.trackInfo?.albumImageUrl ?? ''
		}

		// Look for track progress/duration changes
		let progressChanged = false
		if (forceUpdate || oldState?.trackProgressMs !== newState?.trackProgressMs) {
			progressChanged = true
			variableUpdates['songProgressSeconds'] = ((newState?.trackProgressMs ?? 0) / 1000).toFixed(0)
		}
		if (forceUpdate || oldState?.trackInfo?.durationMs !== newState?.trackInfo?.durationMs) {
			progressChanged = true
			variableUpdates['songDurationSeconds'] = ((newState?.trackInfo?.durationMs ?? 0) / 1000).toFixed(0)
		}
		if (forceUpdate || progressChanged) {
			const progressMs = newState?.trackProgressMs ?? 0
			const durationMs = newState?.trackInfo?.durationMs ?? 0

			variableUpdates['songPercentage'] = durationMs > 0 ? ((progressMs / durationMs) * 100).toFixed(0) : '-'

			const remainingTotalMs = Math.max(durationMs - progressMs, 0) // remaining clamped to >=0
			const remainingSeconds = Math.floor((remainingTotalMs / 1000) % 60)
			const remainingMins = Math.floor((remainingTotalMs / (1000 * 60)) % 60)
			const remainingHours = Math.floor(remainingTotalMs / (1000 * 60 * 60))
			const remainingStr = `${remainingHours.toString().padStart(2, '0')}:${remainingMins
				.toString()
				.padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`

			variableUpdates['songTimeRemaining'] = remainingStr
			variableUpdates['songTimeRemainingHours'] = remainingHours
			variableUpdates['songTimeRemainingMinutes'] = remainingMins
			variableUpdates['songTimeRemainingSeconds'] = remainingSeconds
		}

		// Device info
		if (forceUpdate || oldState?.deviceInfo?.volumePercent !== newState?.deviceInfo?.volumePercent) {
			variableUpdates['volume'] = newState?.deviceInfo?.volumePercent ?? '-'
		}
		if (forceUpdate || oldState?.deviceInfo?.name !== newState?.deviceInfo?.name) {
			invalidatedFeedbacks.push(FeedbackId.ActiveDevice)
			variableUpdates['deviceName'] = newState?.deviceInfo?.name ?? '-'
		}
		if (forceUpdate || oldState?.deviceInfo?.id !== newState?.deviceInfo?.id) {
			invalidatedFeedbacks.push(FeedbackId.ActiveDevice, FeedbackId.PlayingOnAnotherDevice)
			variableUpdates['deviceId'] = newState?.deviceInfo?.id ?? '-'
		}

		// Inform companion of the state changes
		if (invalidatedFeedbacks.length > 0) this.checkFeedbacks(...invalidatedFeedbacks)
		if (Object.keys(variableUpdates).length > 0) this.setVariableValues(variableUpdates)
	}
}

runEntrypoint(SpotifyInstance, UpgradeScripts)
