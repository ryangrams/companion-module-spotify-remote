import { InstanceBase } from '@companion-module/base'
import { DeviceConfig } from './config.js'
import { RequestOptionsBase } from './api/util.js'
import { SpotifyPlaylistInfo } from './state.js'

export interface SpotifyInstanceBase extends InstanceBase<DeviceConfig> {
	config: DeviceConfig

	/**
	 * Check if an error is because of an expired auth token
	 * If so, the token will be renewed, and will return whether to retry the request
	 */
	checkIfApiErrorShouldRetry(err: any): Promise<boolean>

	getRequestOptionsBase(): RequestOptionsBase | null

	startVolumeFade(): AbortSignal

	premuteVolume: number

	/** Fetch the user's playlists again and rebuild everything that lists them */
	refreshPlaylists(): Promise<void>

	/** Move the playlist browser by a number of pages, wrapping at either end */
	changePlaylistPage(delta: number | 'first'): void

	/** The playlist shown in a browser slot on the current page (slot is 1 based) */
	getPlaylistInSlot(slot: number): SpotifyPlaylistInfo | null

	/** Find a playlist by its id or spotify uri */
	findPlaylist(idOrUri: string): SpotifyPlaylistInfo | null

	/** A cover image as a data url ready for a button, cached after the first download */
	getCoverArt(url: string): Promise<string | null>

	// /** Queue a poll for playback status */
	// queuePoll(): void
}
