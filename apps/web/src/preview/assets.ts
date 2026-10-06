import type { StoryInput } from '../types/preview';
import { type Assets, imagePaths } from './story';

function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}

/** The avatar (from its rendered SVG markup) and every image the illustrated story draws. */
export async function loadAssets(input: StoryInput, avatarMarkup: string): Promise<Assets> {
  const svg = avatarMarkup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="660" ');
  const paths = imagePaths(input);
  const [avatar, ...images] = await Promise.all([
    loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`),
    ...paths.map(loadImage),
  ]);
  return { avatar, images: new Map(paths.map((path, i) => [path, images[i]])) };
}
