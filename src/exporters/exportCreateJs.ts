import { AudioSpriteJson } from '../AudioSpriteJson'

export function exportCreateJs( json: AudioSpriteJson ): any {
	const finalJson: any = {}
	finalJson.src = json.resources[0]
	finalJson.data = {audioSprite: []}
	for ( const sn in json.spritemap ) {
		const spriteInfo = json.spritemap[sn]
		finalJson.data.audioSprite.push({
			id: sn,
			startTime: spriteInfo.start * 1000,
			duration: (spriteInfo.end - spriteInfo.start) * 1000
		})
	}
	return finalJson
}
