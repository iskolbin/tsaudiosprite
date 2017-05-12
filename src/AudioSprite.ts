import * as fs from 'fs'
import * as path from 'path'
import { sync as syncDir } from 'mkdirp'
import { tmpdir} from 'os'
import { ChildProcess, spawn } from 'child_process'
import { forEachSeries } from 'async'
import { extend } from './utils'
import { AudioSpriteJson } from './AudioSpriteJson'

import { exportHowler } from './exporters/exportHowler'
import { exportCreateJs } from './exporters/exportCreateJs'
import { exportJukebox } from './exporters/exportJukebox'

export type AudioSpriteExportFormat = 'jukebox' | 'howler' | 'createjs'

export type AudioSpriteExporter = (json: AudioSpriteJson) => any

export interface AudioSpriteLoggerInfo {
	file?: string
	cmd?: string
	name?: string
	format?: string
	i?: number
	duration?: number
}

export interface AudioSpriteLogger {
	debug( message: string, details: AudioSpriteLoggerInfo ): void
	info( message: string, details: AudioSpriteLoggerInfo ): void
	log( message: string, details: AudioSpriteLoggerInfo ): void
}

export const defaultLogger: AudioSpriteLogger = {
	debug: ( _, __ ) => {},
	info: ( _, __ ) => {},
	log: ( _, __ ) => {}
}

export interface AudioSpriteOpts {
	output: string
	path: string
	export: string
	format: AudioSpriteExportFormat
	autoplay?: string
	loop: string[]
	silence: number
	gap: number
	minlength: number
	bitrate: number
	vbr: number
	vbr_vorbis: number
	samplerate: number
	channels: number
	rawparts: string
	logger: AudioSpriteLogger
}

export const defaultOpts: AudioSpriteOpts = {
  output: 'output',
  path: '',
  export: 'ogg,m4a,mp3,ac3',
  format: 'jukebox',
  loop: [],
  silence: 0,
  gap: 1,
  minlength: 0,
  bitrate: 128,
  vbr: -1,
  vbr_vorbis: -1,
  samplerate: 44100,
  channels: 1,
  rawparts: '',
	logger: defaultLogger
}

export interface AudioSpriteCallback {
	( err: any, json?: any ): void
}

export const defaultCallback: AudioSpriteCallback = ( _, __ ) => {}

export class AudioSprite {
	readonly opts: AudioSpriteOpts
	readonly json: AudioSpriteJson = { resources: [], spritemap: {}}
	protected offsetCursor: number = 0
	protected wavArgs: string[] = []
	protected tempFile: string

	static exporters: {[key: string]: AudioSpriteExporter} = {
		howler: exportHowler,
		createjs: exportCreateJs,
		jukebox: exportJukebox
	}

	constructor(
		readonly files: string[],
		readonly callback: AudioSpriteCallback = defaultCallback,
		opts = defaultOpts ) {
			
		if (!files || files.length === 0 ) {
			callback( 'No input files specified.' )
		}

  	this.opts = extend( {}, defaultOpts, opts )

  	// make sure output directory exists
  	const outputDir = path.dirname( this.opts.output )
  	if ( !fs.existsSync( outputDir )) {
    	syncDir( outputDir )
  	}

  	this.wavArgs = ['-ar', this.opts.samplerate.toString(), '-ac', this.opts.channels.toString(), '-f', 's16le']

		this.tempFile = this.mktemp('audiosprite')

  	this.opts.logger.debug('Created temporary file', { file: this.tempFile })

		this.spawn('ffmpeg', ['-version']).on('exit', ( code: number ): void => {
    	if ( code ) {
      	callback( 'ffmpeg was not found on your path' )
    	}
    	if ( opts.silence ) {
      	this.json.spritemap.silence = {
        	start: 0, 
					end: opts.silence,
					loop: true
      	}
      	if ( !opts.autoplay ) {
        	this.json.autoplay = 'silence'
     	 }
      	this.appendSilence( this.opts.silence + this.opts.gap, this.tempFile, this.processFiles )
    	} else {
      	this.processFiles( this.opts )
    	}
		})
	}

	protected mktemp( prefix: string ): string {
    const tmpDir = tmpdir() || '.'
    return path.join( tmpDir, prefix + '.' + Math.random().toString().substr(2) )
  }

 	protected spawn( name: string, opt: string[] ): ChildProcess {
    this.opts.logger.debug( 'Spawn', { cmd: [name].concat( opt ).join(' ') })
    return spawn( name, opt )
  }

	protected pad( num: number, size: number ): string {
    let str = num.toString()
    while ( str.length < size ) {
      str = '0' + str
    }
    return str
  }

  protected makeRawAudioFile( src: string, cb: AudioSpriteCallback ): void {
    const dest = this.mktemp('audiosprite')

    this.opts.logger.debug('Start processing', { file: src })

		fs.exists( src, ( exists: boolean ): void => {
      if ( exists ) {
				const ffmpeg = this.spawn( 'ffmpeg', ['-i', path.resolve( src )].concat( this.wavArgs ).concat('pipe:'))
        ffmpeg.stdout.pipe( fs.createWriteStream( dest, {flags: 'w'} ))
				ffmpeg.on( 'exit', ( code: number, signal: string ): void => {
          if ( code ) {
          	cb( {
              msg: 'File could not be added',
              file: src,
              retcode: code,
              signal: signal
            })
          }
          cb( null, dest )
        })
      } else {
        cb( { msg: 'File does not exist', file: src })
      }
    })
  }

	protected appendFile( name: string, src: string, dest: string, cb: AudioSpriteCallback ): void {
    let size = 0
    const reader = fs.createReadStream( src )
    const writer = fs.createWriteStream( dest, { flags: 'a'} )
		reader.on( 'data', ( data: Buffer | string ): void => {
      size += data.length
    })
		reader.on( 'close', (): void => {
      const originalDuration = size / this.opts.samplerate / this.opts.channels / 2
      this.opts.logger.info('File added OK', { file: src, duration: originalDuration })
      const extraDuration = Math.max(0, this.opts.minlength - originalDuration)
      const duration = originalDuration + extraDuration
      this.json.spritemap[name] = {
        start: this.offsetCursor,
				end: this.offsetCursor + duration,
				loop: name === this.opts.autoplay || (this.opts.loop.indexOf( name ) !== -1)
      }
      this.offsetCursor += originalDuration
      this.appendSilence( extraDuration + Math.ceil( duration ) - duration + this.opts.gap, dest, cb )
    })
    reader.pipe( writer )
  }

	protected appendSilence( duration: number, dest: string, then: ( ...args: any[] ) => void ): void {
    const buffer = new Buffer(Math.round(this.opts.samplerate * 2 * this.opts.channels * duration ))
    buffer.fill( 0 )
    const writeStream = fs.createWriteStream( dest, { flags: 'a' } )
    writeStream.end( buffer )
		writeStream.on( 'close', (): void => {
      this.opts.logger.info('Silence gap added', { duration: duration })
      this.offsetCursor += duration
      then()
    } )
  }

	protected exportFile( src: string, dest: string, ext: string, opt: string[], store: boolean, cb: (...args:any[]) => void ): void {
    const outfile = dest + '.' + ext
		this.spawn(
			'ffmpeg',
			['-y', '-ar', this.opts.samplerate.toString(), '-ac', this.opts.channels.toString(), '-f', 's16le', '-i', src]
				.concat( opt )
				.concat( outfile )).on( 'exit', ( code: number, signal: string ): void => {
					
			if (code) {
				return cb({
					msg: 'Error exporting file',
					format: ext,
					retcode: code,
					signal: signal
				})
			}
			if ( ext === 'aiff' ) {
				this.exportFileCaf( outfile, dest + '.caf', ( err: any ): void => {
					if (!err && store) {
						this.json.resources.push( dest + '.caf' )
					}
					fs.unlinkSync( outfile )
					cb()
				})
			} else {
				this.opts.logger.info( 'Exported ' + ext + ' OK', { file: outfile } )
				if ( store ) {
					this.json.resources.push( outfile )
				}
				cb()
			}
		})
	}

	protected exportFileCaf( src: string, dest: string, cb: (...args: any[]) => void ): void {
    if ( process.platform !== 'darwin' ) {
      cb( true )
    }
    this.spawn('afconvert', ['-f', 'caff', '-d', 'ima4', src, dest])
		.on('exit', ( code: number, signal: string ): void => {
			if ( code ) {
				return cb({
					msg: 'Error exporting file',
					format: 'caf',
					retcode: code,
					signal: signal
				})
			}
			this.opts.logger.info('Exported caf OK', { file: dest })
			return cb()
		})
	}

	protected processFiles( opts: AudioSpriteOpts ): void {
		let formats: {[key: string]: string[]} = {
			aiff: [], 
			wav: [], 
			ac3: ['-acodec', 'ac3', '-ab', opts.bitrate.toString() + 'k'],
			mp3: ['-ar', opts.samplerate.toString(), '-f', 'mp3'], 
			mp4: ['-ab', opts.bitrate.toString() + 'k'], 
			m4a: ['-ab', opts.bitrate.toString() + 'k'], 
			ogg: ['-acodec', 'libvorbis', '-f', 'ogg', '-ab', opts.bitrate.toString() + 'k'],
			webm: ['-acodec',  'libvorbis', '-f', 'webm']
    }

    if ( opts.vbr >= 0 && opts.vbr <= 9 ) {
      formats.mp3 = formats.mp3.concat(['-aq', opts.vbr.toString()])
    } else {
      formats.mp3 = formats.mp3.concat(['-ab', opts.bitrate.toString() + 'k'])
    }

    // change quality of webm output - https://trac.ffmpeg.org/wiki/TheoraVorbisEncodingGuide
    if ( opts.vbr_vorbis >= 0 && opts.vbr_vorbis <= 10 ) {
      formats.webm = formats.webm.concat( ['-qscale:a', opts.vbr_vorbis.toString()] )
    }
    else {
      formats.webm = formats.webm.concat( ['-ab', opts.bitrate.toString() + 'k'] )
    }

    if (opts.export.length) {
			const formats_: {[key: string]: string[]} = {}
			for ( const f of opts.export.split(',')) {
				if ( formats.hasOwnProperty( f )) {
					formats_[f] = formats[f]
				}
			}
			formats = formats_
		}

    const rawparts = opts.rawparts.split(',')
    let i = 0
		forEachSeries( this.files, ( file: string, cb: AudioSpriteCallback ): void => {
      i++
			this.makeRawAudioFile( file, (err: any, tmp: string ): void => {
        if ( err ) {
          cb( err )
        }

				const tempProcessed = (): void => {
          fs.unlinkSync( tmp )
          cb( null )
        }

        const name = path.basename( file ).replace( /\.[a-zA-Z0-9]+$/, '' )
				this.appendFile( name, tmp, this.tempFile, ( _: any ): void => {
					if ( rawparts.length > 0 ) {
						forEachSeries( rawparts, (ext: string, cb: AudioSpriteCallback ): void => {
							this.opts.logger.debug( 'Start export slice', { name: name, format: ext, i: i } )
							this.exportFile( tmp, opts.output + '_' + this.pad(i, 3), ext, formats[ext], false, cb )
						}, tempProcessed)
					} else {
            tempProcessed()
          }
        })
      })
		}, ( err: any ): void => {
      if ( err ) {
        this.callback( 'Error adding file' )
      }
			forEachSeries( Object.keys( formats ), ( ext: string, cb: AudioSpriteCallback ): void => {
        opts.logger.debug('Start export', { format: ext })
        this.exportFile( this.tempFile, opts.output, ext, formats[ext], true, cb )
			}, ( err: any ): void => {
        if ( err ) {
          return this.callback( 'Error exporting file'  )
        }
        if ( this.opts.autoplay ) {
          this.json.autoplay = opts.autoplay
        }
				this.json.resources = this.json.resources.map( ( e:string ): string => {
          return opts.path ? path.join(opts.path, path.basename(e)) : e
        })

				const exporter: AudioSpriteExporter = AudioSprite.exporters[opts.export.toLowerCase()]
				if ( exporter ) {
        	fs.unlinkSync( this.tempFile )
					this.callback( null, exporter( this.json ))
				} else {
					this.callback( 'No exporter for format: ' + opts.export )
				}
      })
    })
  }
}
