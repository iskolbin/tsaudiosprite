import { AudioSpriteJson } from '../AudioSpriteJson'

export function exportHowler( json: AudioSpriteJson ): any {
	const finalJson: any = {}
	finalJson.urls = json.resources.join( ',' )
	finalJson.sprite = {}
	for ( const sn in json.spritemap ) {
		const spriteInfo = json.spritemap[sn]
		finalJson.sprite[sn] = [spriteInfo.start * 1000, (spriteInfo.end - spriteInfo.start) * 1000]
		if ( spriteInfo.loop ) {
			finalJson.sprite[sn].push(true)
		}
	}
	return finalJson
}
