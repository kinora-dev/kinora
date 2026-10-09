import { h } from 'vue'
import { Avatar, AvatarFallback, AvatarImage } from '.'

// A 1x1 PNG, inlined so the story needs no network.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export const WithImage = () => h(Avatar, null, () => [h(AvatarImage, { src: PIXEL, alt: 'Demo User' }), h(AvatarFallback, null, () => 'DU')])

// The image never loads, so the initials stay.
export const Fallback = () => h(Avatar, null, () => [h(AvatarImage, { src: '/missing.png', alt: 'Demo User' }), h(AvatarFallback, null, () => 'DU')])
