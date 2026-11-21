export function signerDocument(text: string) {
  const caption = JSON.stringify(text.trim()).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
html,body,#stage{width:100%;height:100%;margin:0;overflow:hidden;background:#17151c}
canvas{display:block;width:100%;height:100%}
</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
</head><body><div id="stage"></div>
<script type="module">
const report = (type, detail) => window.ReactNativeWebView?.postMessage(JSON.stringify({type,detail}));
try {
  const text = ${caption};
  const [THREE, {GLTFLoader}, {MeshoptDecoder}, retarget] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
    import('https://cdn.jsdelivr.net/npm/@three-ws/retarget@0.1.2/dist/index.mjs'),
  ]);
  const [avatar, sign] = await Promise.all([
    fetch('https://three.ws/avatars/xbot.glb').then(response => {
      if (!response.ok) throw new Error('Avatar model unavailable');
      return response.arrayBuffer();
    }).then(raw => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(retarget.canonicalizeGLBBones(raw).buffer, '')),
    fetch('https://three.ws/api/sign?' + new URLSearchParams({text, lang:'ase'}), {signal: AbortSignal.timeout(20000)})
      .then(response => { if (!response.ok) throw new Error('Sign service unavailable'); return response.json(); }),
  ]);
  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setClearColor(0x17151c);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.append(renderer.domElement);
  const scene = new THREE.Scene();
  const model = avatar.scene;
  scene.add(model, new THREE.HemisphereLight(0xfff1e7, 0x544665, 2.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2,3,4);
  scene.add(key);
  const { clip } = retarget.retargetClipToObject(retarget.parseClipJSON(sign.clip, 'sign'), model);
  if (!clip) throw new Error('Animation could not bind to the signing rig');
  const box = new THREE.Box3().setFromObject(model);
  const height = box.max.y - box.min.y;
  const center = box.getCenter(new THREE.Vector3());
  const aimY = box.max.y - height * 0.25;
  const camera = new THREE.OrthographicCamera(0,0,0,0,0.01,height*10);
  camera.position.set(center.x, aimY, box.max.z + height * 2);
  camera.lookAt(center.x, aimY, center.z);
  const resize = () => {
    const width = stage.clientWidth;
    const screenHeight = stage.clientHeight;
    if (!width || !screenHeight) return;
    renderer.setSize(width, screenHeight, false);
    const aspect = width / screenHeight;
    const halfHeight = Math.max(height * 0.30, height * 0.44 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stage);
  resize();
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  const replay = () => { action.reset().play(); report('playing'); };
  window.guideEyeReplay = replay;
  mixer.addEventListener('finished', () => report('finished'));
  let previous = performance.now();
  renderer.setAnimationLoop(now => {
    mixer.update(Math.min(Math.max((now - previous) / 1000, 0), 0.1));
    previous = now;
    renderer.render(scene, camera);
  });
  replay();
} catch (error) {
  report('error', error instanceof Error ? error.message : 'Playback unavailable');
}
</script></body></html>`;
}
