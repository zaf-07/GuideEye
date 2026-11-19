/**
 * The GuideEye engine screens (camera, bridge, translate, hub) were authored
 * against this palette. It is kept as the single source of truth so the
 * imported surfaces and the new shell render as one app rather than two.
 */
export const legacy = {
  ink: '#07110F',
  lime: '#B7FF56',
  limeBright: '#C8FF72',
  amber: '#FFD043',
  mist: '#9EB5AA',
  haze: '#DDE9E4',
  moss: '#1C3B2E',
  mossDeep: '#11221D',
  slate: '#607B6E',
  sky: '#8FD3FF',
  coral: '#FF8A7A',
} as const;
