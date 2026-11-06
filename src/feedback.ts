import { CompanionFeedbackDefinitions, CompanionFeedbackDefinition } from '@companion-module/base'
import { SpotifyState, SpotifyPlaylistInfo } from './state.js'
import { SpotifyInstanceBase } from './types.js'
import { MAX_PLAYLIST_SLOTS } from './config.js'
import { normalisePlaylistId, playlistChoices } from './actions.js'

/** Warning colours: black text on yellow, so a problem never reads as the green "playing" state */
const WARNING_STYLE = { color: 0x000000, bgcolor: 0xffc310 }

export enum FeedbackId {
	IsPlaying = 'is-playing',
	IsShuffle = 'is-shuffle',
	IsRepeat = 'is-repeat',
	ActiveDevice = 'active-device',
	CurrentContext = 'current-context',
	PlaylistArt = 'playlistArt',
	PlaylistSlotArt = 'playlistSlotArt',
	PlaylistIsPlaying = 'playlistIsPlaying',
	PlaylistSlotIsPlaying = 'playlistSlotIsPlaying',
	PlayingOnAnotherDevice = 'playingOnAnotherDevice',
	PlaybackDeviceOffline = 'playbackDeviceOffline',
}

export function GetFeedbacksList(
	instance: SpotifyInstanceBase,
	getState: () => SpotifyState,
): CompanionFeedbackDefinitions {
	const choices = playlistChoices(getState().playlists)
	const isContext = (playlist: SpotifyPlaylistInfo | null) =>
		!!playlist && getState().playbackState?.currentContext === playlist.id
	const feedbacks: { [id in FeedbackId]: CompanionFeedbackDefinition | undefined } = {
		[FeedbackId.IsPlaying]: {
			type: 'boolean',
			name: 'Change button style if music is playing',
			description: 'If there is active playback, set the button to this colour',
			options: [],
			defaultStyle: {
				color: 0x000000,
				bgcolor: 0x00ff00,
			},
			callback: (_feedback): boolean => !!getState().playbackState?.isPlaying,
		},

		[FeedbackId.IsShuffle]: {
			type: 'boolean',
			name: 'Change button style if shuffle is turned on',
			description: 'If shuffle is enabled, set the button to this colour',
			options: [],
			defaultStyle: {
				color: 0x000000,
				bgcolor: 0x00ff00,
			},
			callback: (_feedback): boolean => !!getState().playbackState?.isShuffle,
		},

		[FeedbackId.IsRepeat]: {
			type: 'boolean',
			name: 'Change button style based on repeat state',
			description: 'If repeat state matches given state change button colors',
			options: [
				{
					type: 'dropdown',
					label: 'Repeat state to match',
					id: 'type',
					default: 'track',
					choices: [
						{
							label: 'off',
							id: 'off',
						},
						{
							label: 'context',
							id: 'context',
						},
						{
							label: 'track',
							id: 'track',
						},
					],
				},
			],
			defaultStyle: {
				color: 0x000000,
				bgcolor: 0x00ff00,
			},
			callback: (feedback): boolean => getState().playbackState?.repeatState == feedback.options.type,
		},

		[FeedbackId.ActiveDevice]: {
			type: 'boolean',
			name: 'Change button style if active device name matches value',
			description: 'If active device name matches value, change button color',
			options: [
				{
					type: 'textinput',
					label: 'Device Name (case insensitive)',
					id: 'device',
					useVariables: true,
				},
			],
			defaultStyle: {
				color: 0x000000,
				bgcolor: 0x00ff00,
			},
			callback: (feedback): boolean =>
				typeof feedback.options.device === 'string' &&
				getState().playbackState?.deviceInfo?.name?.toLowerCase() == feedback.options.device.toLowerCase(),
		},

		[FeedbackId.CurrentContext]: {
			type: 'boolean',
			name: 'Change button style if current album/artist/playlist/track id matches value',
			description: 'If active album/artist/playlist/track matches value, change button color',
			options: [
				{
					type: 'textinput',
					label: 'Item ID',
					id: 'id',
					useVariables: true,
				},
			],
			defaultStyle: {
				color: 0x000000,
				bgcolor: 0x00ff00,
			},
			callback: (feedback): boolean => {
				const currentContext = getState().playbackState?.currentContext
				// _instance.log(
				// 	'debug',
				// 	`Feedback check for current context. Feedback value: ${feedback.options.id}, Current context: ${JSON.stringify(currentContext)}`,
				// )

				const feedbackContext = feedback.options.id as string
				const feedbackContext_uri = feedbackContext.startsWith('spotify:')
					? feedbackContext.substring(feedbackContext.lastIndexOf(':') + 1)
					: feedbackContext

				// _instance.log(
				// 	'debug',
				// 	`Feedback check for current context. Feedback value: ${feedbackContext_uri}, Current context: ${JSON.stringify(currentContext)}`,
				// )
				return currentContext == feedbackContext_uri
			},
		},

		[FeedbackId.PlaylistArt]: {
			type: 'advanced',
			name: 'Show a playlist cover on the button',
			description: 'Draws the cover art of the chosen playlist',
			options: [
				{
					type: 'dropdown',
					label: 'Playlist',
					id: 'playlist',
					choices,
					default: choices[0]?.id ?? '',
					allowCustom: true,
				},
			],
			callback: async (feedback) => {
				const playlist = instance.findPlaylist(normalisePlaylistId(String(feedback.options.playlist ?? '')))
				const png64 = playlist?.imageUrl ? await instance.getCoverArt(playlist.imageUrl) : null
				return png64 ? { png64 } : {}
			},
		},

		[FeedbackId.PlaylistSlotArt]: {
			type: 'advanced',
			name: 'Playlist browser: show the cover in a slot',
			description: 'Draws the cover art of whichever playlist the browser shows in this slot',
			options: [
				{
					type: 'number',
					label: 'Slot',
					id: 'slot',
					default: 1,
					min: 1,
					max: MAX_PLAYLIST_SLOTS,
					step: 1,
				},
			],
			callback: async (feedback) => {
				const playlist = instance.getPlaylistInSlot(Number(feedback.options.slot))
				const png64 = playlist?.imageUrl ? await instance.getCoverArt(playlist.imageUrl) : null
				return png64 ? { png64 } : {}
			},
		},

		[FeedbackId.PlaylistIsPlaying]: {
			type: 'boolean',
			name: 'Change button style if a playlist is playing',
			description: 'True while the chosen playlist is the one playing',
			options: [
				{
					type: 'dropdown',
					label: 'Playlist',
					id: 'playlist',
					choices,
					default: choices[0]?.id ?? '',
					allowCustom: true,
				},
			],
			defaultStyle: {
				color: 0x1ed760,
			},
			callback: (feedback): boolean => {
				const id = normalisePlaylistId(String(feedback.options.playlist ?? ''))
				return !!id && getState().playbackState?.currentContext === id
			},
		},

		[FeedbackId.PlaylistSlotIsPlaying]: {
			type: 'boolean',
			name: 'Playlist browser: change style if the slot is playing',
			description: 'True while the playlist in this browser slot is the one playing',
			options: [
				{
					type: 'number',
					label: 'Slot',
					id: 'slot',
					default: 1,
					min: 1,
					max: MAX_PLAYLIST_SLOTS,
					step: 1,
				},
			],
			defaultStyle: {
				color: 0x1ed760,
			},
			callback: (feedback): boolean => isContext(instance.getPlaylistInSlot(Number(feedback.options.slot))),
		},

		[FeedbackId.PlayingOnAnotherDevice]: {
			type: 'boolean',
			name: 'Warn when music is playing on another device',
			description:
				'True while Spotify plays somewhere other than the playback device in the connection settings, such as a phone',
			options: [],
			defaultStyle: WARNING_STYLE,
			callback: (): boolean => {
				const playback = getState().playbackState
				const deviceId = instance.config.deviceId
				return !!deviceId && !!playback?.isPlaying && !!playback.deviceInfo && playback.deviceInfo.id !== deviceId
			},
		},

		[FeedbackId.PlaybackDeviceOffline]: {
			type: 'boolean',
			name: 'Warn when the playback device is offline',
			description:
				'True while the playback device does not appear in Spotify, usually because the Spotify app on it is closed',
			options: [],
			defaultStyle: WARNING_STYLE,
			callback: (): boolean => {
				const devices = getState().devices
				const deviceId = instance.config.deviceId
				if (!deviceId) return true
				return devices !== null && !devices.find((d) => d.id === deviceId)
			},
		},
	}

	return feedbacks
}
