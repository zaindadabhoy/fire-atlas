import React from 'react'
import { Composition } from 'remotion'
import { FireAtlasDemo } from './Video'
import { FireAtlasLong } from './long/LongVideo'
import { TOTAL as LONG_TOTAL } from './long/timeline'
import { FPS, H, TOTAL_FRAMES, W } from './theme'

export const Root: React.FC = () => (
  <>
    <Composition id="FireAtlasDemo" component={FireAtlasDemo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} />
    <Composition id="FireAtlasLong" component={FireAtlasLong} durationInFrames={LONG_TOTAL} fps={FPS} width={W} height={H} />
  </>
)
