export function extend( dest: any, ...srcs: any[] ): any {
	for ( const src of srcs ) {
		for ( const k in src ) {
			dest[k] = src[k]
		}
	}
	return dest
}
