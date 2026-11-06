import got from 'got'
import { Response, doGetRequest, RequestOptionsBase, DefaultTimeout } from './util.js'

/** The page size Spotify allows for GET /v1/me/playlists */
export const PLAYLIST_PAGE_LIMIT = 50

/**
 * The playlist object as returned by GET /v1/me/playlists.
 * Since February 2026 the track summary field is `items` for Development Mode apps, while older
 * apps still receive `tracks`, so both are accepted.
 */
export interface SimplifiedPlaylistResponse {
	id: string
	name: string
	uri: string
	images: SpotifyApi.ImageObject[] | null
	owner?: { display_name?: string | null; id?: string } | null
	items?: { total?: number } | null
	tracks?: { total?: number } | null
}

export interface PlaylistPageResponse {
	items: Array<SimplifiedPlaylistResponse | null>
	next: string | null
	total: number
}

export async function getMyPlaylists(
	reqOptions: RequestOptionsBase,
	offset: number,
): Promise<Response<PlaylistPageResponse | undefined>> {
	return doGetRequest(reqOptions, `/v1/me/playlists?limit=${PLAYLIST_PAGE_LIMIT}&offset=${offset}`)
}

/**
 * Download an image from the Spotify CDN. These urls are public and need no authorization.
 */
export async function getImageBuffer(url: string): Promise<{ buffer: Buffer; contentType: string | undefined }> {
	const res = await got.get(url, {
		responseType: 'buffer',
		timeout: {
			request: DefaultTimeout,
		},
	})

	return { buffer: Buffer.from(res.body), contentType: res.headers['content-type'] }
}
