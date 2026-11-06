import { CompanionPresetDefinitions, CompanionButtonPresetDefinition } from '@companion-module/base'
import { ActionId } from './actions.js'
import { FeedbackId } from './feedback.js'
import { SpotifyPlaylistInfo } from './state.js'

/** Keeps the presets panel usable for very large libraries. Playlist ids are base62, so safe in a preset id */
const MAX_PLAYLIST_PRESETS = 200

const BLACK = 0x000000
const WHITE = 0xffffff

function simpleButton(
	category: string,
	name: string,
	text: string,
	actionId: ActionId,
	options: Record<string, string | number | boolean> = {},
): CompanionButtonPresetDefinition {
	return {
		type: 'button',
		category,
		name,
		style: { text, size: '14', color: WHITE, bgcolor: BLACK },
		feedbacks: [],
		steps: [{ down: [{ actionId, options }], up: [] }],
	}
}

const PLAYLIST_START_DEFAULTS = {
	behavior: 'resume',
	shuffle: 'leave',
	fadeIn: false,
	startVolume: 0,
	targetVolume: 85,
	fadeDurationMs: 5000,
}

export function GetPresetsList(
	label: string,
	playlists: SpotifyPlaylistInfo[] | null,
	slotCount: number,
): CompanionPresetDefinitions {
	const presets: CompanionPresetDefinitions = {}

	// Transport
	presets['transport_playPause'] = {
		...simpleButton('Transport', 'Play / Pause', `$(${label}:isPlayingIcon)`, ActionId.PlayPause, {
			fadeOut: false,
			fadeIn: false,
			startVolume: 0,
			targetVolume: 85,
			fadeDurationMs: 5000,
		}),
		style: { text: `$(${label}:isPlayingIcon)`, size: '44', color: WHITE, bgcolor: BLACK },
		feedbacks: [
			{ feedbackId: FeedbackId.IsPlaying, options: {}, style: { color: BLACK, bgcolor: 0x1ed760 } },
			{ feedbackId: FeedbackId.PlayingOnAnotherDevice, options: {}, style: { color: BLACK, bgcolor: 0xffc310 } },
			{ feedbackId: FeedbackId.PlaybackDeviceOffline, options: {}, style: { color: BLACK, bgcolor: 0xffc310 } },
		],
	}
	presets['transport_previous'] = simpleButton('Transport', 'Previous track', '⏮', ActionId.Previous)
	presets['transport_skip'] = simpleButton('Transport', 'Skip track', '⏭', ActionId.Skip)
	presets['transport_shuffle'] = {
		...simpleButton('Transport', 'Shuffle', 'Shuffle', ActionId.ShuffleToggle),
		feedbacks: [{ feedbackId: FeedbackId.IsShuffle, options: {}, style: { color: BLACK, bgcolor: 0x1ed760 } }],
	}
	presets['transport_volumeUp'] = simpleButton(
		'Transport',
		'Volume up',
		'Vol +\\n$(' + label + ':volume)',
		ActionId.VolumeUp,
		{
			volumeUpAmount: 5,
		},
	)
	presets['transport_volumeDown'] = simpleButton(
		'Transport',
		'Volume down',
		'Vol -\\n$(' + label + ':volume)',
		ActionId.VolumeDown,
		{ volumeDownAmount: 5 },
	)
	presets['transport_mute'] = simpleButton('Transport', 'Mute toggle', 'Mute', ActionId.MuteToggle)
	presets['transport_nowPlayingButton'] = {
		...simpleButton(
			'Transport',
			'Now playing',
			`$(${label}:songName)\\n$(${label}:artistName)\\n$(${label}:deviceName)`,
			ActionId.TransferToPlaybackDevice,
			{ play: false },
		),
		style: {
			text: `$(${label}:songName)\\n$(${label}:artistName)\\n$(${label}:deviceName)`,
			size: '7',
			color: WHITE,
			bgcolor: BLACK,
		},
		feedbacks: [
			{ feedbackId: FeedbackId.PlayingOnAnotherDevice, options: {}, style: { color: BLACK, bgcolor: 0xffc310 } },
			{ feedbackId: FeedbackId.PlaybackDeviceOffline, options: {}, style: { color: BLACK, bgcolor: 0xffc310 } },
		],
	}
	presets['device_bringBack'] = {
		...simpleButton('Transport', 'Bring playback here', 'Play here', ActionId.TransferToPlaybackDevice, {
			play: false,
		}),
		feedbacks: [
			{ feedbackId: FeedbackId.PlayingOnAnotherDevice, options: {}, style: { color: BLACK, bgcolor: 0xffc310 } },
		],
	}

	// Playlist browser: a fixed grid of slots that pages through the whole library
	for (let slot = 1; slot <= slotCount; slot++) {
		presets[`browser_slot_${slot}`] = {
			type: 'button',
			category: 'Playlist browser',
			name: `Slot ${slot}`,
			style: {
				text: `$(${label}:playlistSlot${slot}Name)`,
				size: '7',
				color: WHITE,
				bgcolor: BLACK,
				alignment: 'center:bottom',
				pngalignment: 'center:center',
			},
			feedbacks: [
				{ feedbackId: FeedbackId.PlaylistSlotArt, options: { slot } },
				{ feedbackId: FeedbackId.PlaylistSlotIsPlaying, options: { slot }, style: { color: 0x1ed760 } },
			],
			steps: [
				{ down: [{ actionId: ActionId.PlayPlaylistSlot, options: { slot, ...PLAYLIST_START_DEFAULTS } }], up: [] },
			],
		}
	}
	presets['browser_previous'] = {
		...simpleButton(
			'Playlist browser',
			'Previous page',
			'◀\\n$(' + label + ':playlistPageLabel)',
			ActionId.PlaylistPage,
			{
				direction: 'previous',
			},
		),
	}
	presets['browser_next'] = {
		...simpleButton('Playlist browser', 'Next page', '▶\\n$(' + label + ':playlistPageLabel)', ActionId.PlaylistPage, {
			direction: 'next',
		}),
	}
	presets['browser_refresh'] = simpleButton(
		'Playlist browser',
		'Refresh playlists',
		'Refresh\\nplaylists',
		ActionId.RefreshPlaylists,
	)

	// One button per playlist, for decks that pin favourites
	for (const playlist of (playlists ?? []).slice(0, MAX_PLAYLIST_PRESETS)) {
		presets[`playlist_${playlist.id}`] = {
			type: 'button',
			category: 'My playlists',
			name: playlist.name,
			style: {
				text: playlist.name,
				size: '7',
				color: WHITE,
				bgcolor: BLACK,
				alignment: 'center:bottom',
				pngalignment: 'center:center',
			},
			feedbacks: [
				{ feedbackId: FeedbackId.PlaylistArt, options: { playlist: playlist.id } },
				{ feedbackId: FeedbackId.PlaylistIsPlaying, options: { playlist: playlist.id }, style: { color: 0x1ed760 } },
			],
			steps: [
				{
					down: [{ actionId: ActionId.PlayPlaylist, options: { playlist: playlist.id, ...PLAYLIST_START_DEFAULTS } }],
					up: [],
				},
			],
		}
	}

	return presets
}
