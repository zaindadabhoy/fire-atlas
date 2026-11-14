import React from 'react'
import { Composition } from 'remotion'
import { FireAtlasDemo } from './Video'
import { FPS, H, TOTAL_FRAMES, W } from './theme'

export const Root: React.FC = () => (
  <Composition id="FireAtlasDemo" component={FireAtlasDemo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} />
)
