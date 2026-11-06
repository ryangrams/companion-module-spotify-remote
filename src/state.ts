export interface SpotifyState {
	playbackState: SpotifyPlaybackState | null

	/** The user's playlists, in the order Spotify returns them. null until the first successful fetch */
	playlists: SpotifyPlaylistInfo[] | null
	/** Zero based page of the playlist browser */
	playlistPage: number

	/** The devices available to the account, from the last device poll. null until the first poll */
	devices: SpotifyDeviceSummary[] | null
}

export interface SpotifyPlaybackState {
	isPlaying: boolean
	isShuffle: boolean
	repeatState: 'off' | 'track' | 'context'
	currentContext: string | null

	trackProgressMs: number
	trackInfo: SpotifyTrackInfo | null

	deviceInfo: SpotifyDeviceInfo | null
}

export interface SpotifyTrackInfo {
	durationMs: number
	name: string
	artistName: string | null
	albumName: string | null
	albumImageUrl: string | null
}

export interface SpotifyDeviceInfo {
	id: string | null
	name: string
	volumePercent: number | null
}

export interface SpotifyPlaylistInfo {
	id: string
	name: string
	uri: string
	ownerName: string | null
	/** The smallest cover image that still fills a button, if the playlist has one */
	imageUrl: string | null
	/** Number of tracks, when Spotify reports it */
	trackCount: number | null
}

export interface SpotifyDeviceSummary {
	id: string
	name: string
	type: string
	isActive: boolean
}
