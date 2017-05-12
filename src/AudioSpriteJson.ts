export interface AudioSpriteJson { 
	resources: string[]
	spritemap: {[key: string]: {
		start: number,
		end: number,
		loop: boolean
	}}
	autoplay?: string
}
