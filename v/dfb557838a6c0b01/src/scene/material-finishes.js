import * as THREE from '../vendor/three.module.js';
import { cardFinishKind } from './card-finish-types.js';

// Japanese LOCR finishes shared by the study, catalog and game.
// One opaque surface: printing, foil, relief and raised ink share depth.
const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
varying vec3 vCenter;
void main(){
  vUv=uv;
  vec4 world=modelMatrix*vec4(position,1.0);
  vPosition=world.xyz;
  vN=normalize(mat3(modelMatrix)*vec3(0.,0.,1.));
  vT=normalize(mat3(modelMatrix)*vec3(1.,0.,0.));
  vB=normalize(mat3(modelMatrix)*vec3(0.,1.,0.));
  vCenter=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
  gl_Position=projectionMatrix*viewMatrix*world;
}`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D printMap;
uniform sampler2D finishMap;
uniform sampler2D reliefMap;
uniform sampler2D borderMap;
uniform sampler2D accentMap;
uniform sampler2D serialMap;
uniform float serialMode;
uniform vec4 artFrame;
uniform vec4 artWindow;
uniform vec3 lightPosition;
uniform float kind;
uniform float foilEnabled;
uniform float reliefEnabled;
uniform float exposure;
uniform float diffuseIntensity;
varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
varying vec3 vCenter;
const float TAU=6.2831853;
vec3 spectrum(float phase){
  // A smooth, bounded approximation of visible diffraction orders.
  return .48+.46*cos(TAU*(phase+vec3(0.0,.333,.667)));
}
float band(float phase,float width){
  float aa=min(.49,max(fwidth(phase)*.7,.025));
  float d=abs(fract(phase)-.5);
  return 1.0-smoothstep(width-aa,width+aa,d);
}
float cellSeed(vec2 cell){
  return fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
}
float filmNoise(vec2 p){
  vec2 cell=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(cellSeed(cell),cellSeed(cell+vec2(1.,0.)),f.x),
             mix(cellSeed(cell+vec2(0.,1.)),cellSeed(cell+vec2(1.,1.)),f.x),f.y);
}
vec3 foilSpectrum(float phase){
  // Bounded coloured orders in linear light. A zero in the complementary
  // channel prevents strong red/green/blue glints turning pastel in ACES.
  vec3 hue=clamp(abs(fract(-phase+vec3(0.,.667,.333))*6.-3.)-1.,0.,1.);
  return pow(hue,vec3(2.2));
}
float resolvedDiffractionLine(float carrier,float offset,float width,float footprint){
  float filtered=sqrt(width*width+footprint*footprint);
  float distance=abs(fract(carrier+offset)-.5);
  return exp(-pow(distance/filtered,2.))*width/filtered;
}
float diffractionLine(float carrier,float offset,float width){
  // Registered film directions remain fixed. Light may gently taper the
  // supplied main width; filtering also resolves detail at distant zoom.
  float footprint=max(fwidth(carrier)*.45,.001);
  return resolvedDiffractionLine(carrier,offset,width,footprint);
}
float mainAngularResponse(float theta){
  // Keep the pre-half-floor minimum and peak, but narrow the darkest trough.
  // Squaring this smooth angular distance brightens intermediate light views.
  float darkness=.5-.5*cos(theta);
  return exp(-5.6*darkness*darkness);
}
float verticalMainWidth(float order,float along){
  return (.0276+.0184*cellSeed(vec2(order,41.)))
         *(.45+1.15*filmNoise(vec2(order*7.3,along*19.)));
}
float horizontalMainWidth(float order,float along){
  return (.0276+.0184*cellSeed(vec2(order,83.)))
         *(.45+1.15*filmNoise(vec2(along*17.,order*8.7)))*(4.2*590./(3.*860.));
}
vec4 iconDiamondFilm(vec2 uv,vec2 angles,float transmission){
  // Small fixed diamond cuts sit over the smooth icon foil. Each cut has
  // its own face orientation, so light reveals clusters rather than moving
  // noise. Filter unresolved cuts to their area coverage at distant zoom.
  vec2 p=uv*vec2(590.,860.)/4.2;
  p.x+=cellSeed(vec2(floor(p.y),91.))*.7;
  vec2 cell=floor(p),q=fract(p)-.5;
  float seed=cellSeed(cell+vec2(71.,29.));
  float face=cellSeed(cell+vec2(13.,83.));
  q+=(vec2(seed,face)-.5)*.16;
  float radius=.32+.13*face;
  float distance=abs(q.x)+abs(q.y);
  float aa=max(fwidth(p.x)+fwidth(p.y),.04)*.45;
  float cut=1.-smoothstep(radius-aa,radius+aa,distance);
  float resolved=1.-smoothstep(.8,1.8,max(fwidth(p.x),fwidth(p.y)));
  cut=mix(2.*radius*radius,cut,resolved);
  vec2 facetTilt=(vec2(seed,face)-.5)*1.7;
  float response=exp(-pow((dot(angles,normalize(facetTilt+vec2(.02,.03)))
                         -(seed-.5)*1.15)/.19,2.));
  float bevel=.55+.45*smoothstep(-aa,aa,q.x-q.y);
  vec3 hue=foilSpectrum(dot(angles,vec2(.72,.61))+seed*.74+bevel*.10);
  vec3 reflection=hue*(.10+response*2.8)*bevel
                  +vec3(pow(response,5.)*.52);
  return vec4(reflection*cut*transmission,cut*response*.20);
}
vec4 secretFilm(vec2 uv,vec2 angles,vec2 axisAngles,float broad,float lambert,float transmission){
  // Short horizontal ridges from the 0-20s reference. Their apparent pitch
  // includes video sampling, so these are visual scales, not die dimensions.
  // Vary the stamped facets, never their registration on the printed card.
  // SER/PSE/GMR use this same film; masks/raised ink supply the differences.
  vec2 pitch=vec2(112.,296.);
  vec2 p=uv*pitch;
  p.x+=cellSeed(vec2(floor(p.y),17.))*.72;
  vec2 cell=floor(p),q=fract(p)-.5;
  float seed=cellSeed(cell);
  float group=cellSeed(floor(cell/vec2(3.,7.)));
  float shape=cellSeed(cell+vec2(53.,19.));
  q.x+=(seed-.5)*.16;
  q.y+=(shape-.5)*.11+q.x*(group-.5)*.13;
  float length=.075+.12*shape;
  float width=.18+.25*seed;
  float aaX=max(fwidth(p.x)*.50,.018);
  float aaY=max(fwidth(p.y)*.50,.018);
  float grain=(1.-smoothstep(width-aaX,width+aaX,abs(q.x)))
             *(1.-smoothstep(length-aaY,length+aaY,abs(q.y)));
  // Above one cell per pixel, fade unresolved detail to its small true area
  // coverage. This avoids sparkling moire and a uniformly bright white grid.
  float resolved=1.-smoothstep(.85,1.8,max(fwidth(p.x),fwidth(p.y)));
  grain=mix(4.*width*length,grain,resolved);
  // Etches are stamped in film coordinates. Lighting selects a slowly
  // displaced bright envelope without rotating the underlying grain.
  // Bounded sine response prevents fast scrolling or wraps at grazing light.
  // Double displacement at every light position, hence double movement
  // speed for the same pointer/light trajectory without changing its phase.
  float carrier=uv.x*3.0+.60+.30*sin(axisAngles.x*.85+axisAngles.y*.20);
  float crossing=uv.y*4.2+.31+.30*sin(axisAngles.y*.85-axisAngles.x*.20);
  float stripe=floor(carrier),crossStripe=floor(crossing);
  float stripeSeed=cellSeed(vec2(stripe,41.));
  float crossSeed=cellSeed(vec2(crossStripe,83.));
  // Main bands contain continuous short etches, not several columns of
  // isolated dots. Their coarser row pitch follows the aligned close-ups.
  // Row length, height and stagger are fixed by the die, independent of light.
  float rowP=uv.y*184.;
  float ridgeSeed=cellSeed(vec2(stripe+19.,floor(rowP)));
  float ridgeTip=cellSeed(vec2(stripe+73.,floor(rowP)));
  float rowHeight=.15+.06*ridgeTip;
  float rowDistance=abs(fract(rowP)-.5+(ridgeSeed-.5)*.15
                       +(fract(carrier)-.5)*(ridgeTip-.5)*.25);
  float rowAA=max(fwidth(rowP)*.5,.018);
  float rowResolved=1.-smoothstep(.85,1.8,fwidth(rowP));
  float ridge=1.-smoothstep(rowHeight-rowAA,rowHeight+rowAA,rowDistance);
  // Preserve area-average energy as etched rows become subpixel.
  ridge=mix(2.*rowHeight,ridge,rowResolved)*.52;
  // Stamp irregular spacing, a lightly ragged edge and varying width into
  // the film itself. Long/short ridges and gaps remain registered forever.
  float seam=filmNoise(vec2(stripe*7.3,uv.y*19.));
  float fineSeam=filmNoise(vec2(stripe*9.1+37.,uv.y*71.));
  float crossSeam=filmNoise(vec2(uv.x*17.,crossStripe*8.7));
  float tilt=(stripeSeed-.5)*.04+(seam-.5)*.0325+(ridgeSeed-.5)*.011;
  float crossTilt=(crossSeed-.5)*.10+(crossSeam-.5)*.017+(shape-.5)*.009;
  float localTilt=(filmNoise(vec2(stripe*5.1,uv.y*5.8))-.5)*2.65
                   +(seam-.5)*1.10+(ridgeSeed-.5)*.25;
  float crossLocal=(filmNoise(vec2(uv.x*5.4,crossStripe*6.3))-.5)*1.25
                    +(crossSeam-.5)*.55+(shape-.5)*.22;
  float theta=dot(axisAngles,vec2(3.8,1.25))+(stripe-1.5)*1.05+localTilt;
  float crossTheta=dot(axisAngles,vec2(-1.45,4.0))+(crossStripe-1.5)*1.35+crossLocal;
  // Edge widths are 3/4 of the centre width, blending back within 56px.
  vec2 mainEdgePixels=min(uv,1.-uv)*vec2(590.,860.);
  float edgeWidth=.75+.25*smoothstep(32.,56.,min(mainEdgePixels.x,mainEdgePixels.y));
  float lightWidth=.75+.25*(.5+.5*cos(dot(axisAngles,vec2(3.8,1.25))));
  float crossLightWidth=.75+.25*(.5+.5*cos(dot(axisAngles,vec2(-1.45,4.0))));
  float orderWidth=verticalMainWidth(stripe,uv.y)*edgeWidth*lightWidth;
  // Match physical pixel width in the 590:860 card, including tapered ends.
  float crossWidth=horizontalMainWidth(crossStripe,uv.x)*edgeWidth*crossLightWidth;
  float stamped=diffractionLine(carrier,tilt,orderWidth);
  float crossStamped=diffractionLine(crossing,crossTilt,crossWidth);
  float stampDepth=(.30+.70*smoothstep(.12,.80,fineSeam))*(.65+.35*group);
  float crossDepth=.25+.75*filmNoise(vec2(uv.x*63.+14.,crossStripe*11.));
  float response=mainAngularResponse(theta);
  float crossResponse=.14+.86*mainAngularResponse(crossTheta);
  float blaze=stamped*response*stampDepth;
  float secondary=crossStamped*crossResponse*crossDepth*(.65+.35*group);
  // The same immobile stripe can show different wavelengths as the light
  // changes. Neighbouring stripes and their fixed flanks have distinct hues.
  float phase=uv.y*1.65+uv.x*.45+dot(axisAngles,vec2(2.2,1.45))
              +dot(angles-axisAngles,vec2(.4,.4))+(seed-.5)*.06;
  float flank=clamp((fract(carrier+tilt)-.5)/max(orderWidth,.001),-2.,2.);
  // In the aligned reference, hue runs yellow/red -> violet/blue -> green
  // down the card. UV.y runs upward; the main order must reverse the generic
  // sparkle/crossing phase and span about one visible cycle per card height.
  float mainPhase=phase-uv.y*2.30-(seed-.5)*.06+(ridgeSeed-.5)*.06+floor(carrier)*.26+flank*.065;
  vec3 spectral=foilSpectrum(mainPhase);
  vec3 crossSpectrum=foilSpectrum(phase+floor(crossing)*.23+.27);
  float intensity=(.20+.80*broad)*grain*.12;
  float flash=grain*mix(.30,1.,resolved)*(.50+.50*lambert);
  float ridgeFlash=ridge*mix(.30,1.,rowResolved)*(.50+.50*lambert);
  float reflection=.08+.92*pow(transmission,.65);
  // Sparse off-band facets blink with angle too, so the quiet surface is
  // still foil. A neutral specular peak is rare; most glints remain coloured.
  float facetTilt=(shape-.5)*1.65+(group-.5)*.45;
  float sparkle=exp(-pow((dot(angles,vec2(.65,1.))-facetTilt)/.065,2.));
  sparkle*=smoothstep(.55,.90,fract(seed*37.1));
  float whitePeak=(pow(blaze,5.)+sparkle*.25)*smoothstep(.994,1.,seed)*7.;
  float facetResponse=.42+.58*fract(seed*19.3);
  vec3 facetSpectrum=foilSpectrum(phase+(group-.5)*.44);
  float mainCrest=.90+.70*pow(response,4.);
  float crossCrest=.90+.55*pow(crossResponse,4.);
  float mainStrength=164.*sqrt(2.8/2.4);
  // Sparse glints use the same peak scale as a resolved main etch (.52),
  // with fixed facet variation instead of a moving main-stripe seed.
  float sparkleStrength=mainStrength*1.60*.52*(.55+.32*shape);
  vec3 sparkleFlare=facetSpectrum*sparkle*sparkleStrength*flash;
  vec3 flare=crossSpectrum*secondary*125.*crossCrest+vec3(whitePeak);
  // Strengthen angular crests while preserving quiet off-angle film. The
  // square-root term retains the existing narrower-lobe compensation.
  vec3 mainFlare=spectral*blaze*mainStrength*mainCrest*ridgeFlash*(.55+.32*ridgeTip);
  // At a reflecting facet, less diffuse ink reaches the eye. Merely adding
  // light bleaches the coloured ridges, especially over pale printed areas.
  float glintCoverage=clamp((sqrt(ridge)*blaze+sqrt(grain)*(secondary*.60+sparkle*.42))*3.1,0.,.96);
  return vec4(facetSpectrum*intensity*transmission+(mainFlare+sparkleFlare+flare*flash*facetResponse)*reflection,glintCoverage);
}
void main(){
  vec3 ink=texture2D(printMap,vUv).rgb;
  // N/NR are diffuse print; R adds smooth silver reflection to name glyphs
  // only. They bypass varnish, icon foil, relief, frames and holographic film.
  if(kind==7.0||kind==8.0){
    vec3 normal=normalize(vN);
    vec3 light=normalize(lightPosition-vPosition);
    float diffuse=max(dot(normal,light),0.);
    vec3 printed=ink*(.72+.31*diffuse)*diffuseIntensity;
    if(kind==8.0){
      vec3 view=normalize(cameraPosition-vPosition);
      vec3 halfway=normalize(light+view);
      float reflection=max(dot(normal,halfway),0.);
      float broad=pow(reflection,12.);
      float glint=pow(reflection,180.);
      float nameMask=texture2D(finishMap,vUv).b*foilEnabled;
      vec3 silver=vec3(.47,.50,.53)*(.60+.50*diffuse)
                  +vec3(broad*.28+glint*.65);
      printed=mix(printed,silver,nameMask*.94);
    }
    gl_FragColor=vec4(max(printed*exposure,vec3(0.)),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  vec4 zone=texture2D(finishMap,vUv);
  vec4 reliefTex=texture2D(reliefMap,vUv);
  // Runtime GMR stamps replace the catalog's preview number in every channel.
  // The accepted foil optics below remain unchanged.
  vec2 pixel=vec2(vUv.x*590.,(1.-vUv.y)*860.);
  float srArt=1.;
  if(kind==0.0){
    srArt=step(artWindow.x,pixel.x)*step(pixel.x,artWindow.z)
         *step(artWindow.y,pixel.y)*step(pixel.y,artWindow.w);
    zone*=srArt;
  }
  float serialPanel=0.;
  float serialGlyph=0.;
  // Leave only a small margin after the engraved number, with an outward slope.
  float serialRight=121.+8.*clamp((pixel.y-812.)/28.,0.,1.);
  if(serialMode>.5&&pixel.x>=29.&&pixel.x<serialRight&&pixel.y>=812.&&pixel.y<840.){
    vec2 stampUv=vec2((pixel.x-29.)/160.,1.-(pixel.y-812.)/28.);
    float stamp=texture2D(serialMap,stampUv).r;
    serialPanel=1.;
    serialGlyph=stamp;
    ink=mix(vec3(.031),vec3(.71),stamp);
    // The dark plaque and fine engraved digits have their own quiet response.
    // Remove the catalog's preview foil/emboss channels throughout this area.
    zone=vec4(0.,stamp*.28,0.,0.);
    vec2 slope=vec2(
      texture2D(serialMap,stampUv+vec2(1./160.,0.)).r-texture2D(serialMap,stampUv-vec2(1./160.,0.)).r,
      texture2D(serialMap,stampUv+vec2(0.,1./28.)).r-texture2D(serialMap,stampUv-vec2(0.,1./28.)).r);
    reliefTex=vec4(normalize(vec3(-slope*.32,1.))*.5+.5,1.);
  }
  vec3 sampled=reliefTex.rgb*2.0-1.0;
  float relief=zone.g*reliefEnabled;
  float depth=(kind>5.5?1.0:.34)*relief;
  vec3 N=normalize(vN*sampled.z+vT*sampled.x*depth+vB*sampled.y*depth);
  vec3 L=normalize(lightPosition-vPosition);
  vec3 V=normalize(cameraPosition-vPosition);
  vec3 H=normalize(L+V);
  vec2 incident=vec2(dot(L,vT),dot(L,vB));
  vec2 sight=vec2(dot(V,vT),dot(V,vB));
  vec3 centerL=normalize(lightPosition-vCenter);
  vec3 centerV=normalize(cameraPosition-vCenter);
  vec2 axisAngles=vec2(dot(centerL+centerV,vT),dot(centerL+centerV,vB));
  vec2 halfAngle=vec2(dot(H,vT),dot(H,vB));
  float lambert=max(dot(N,L),0.0);
  float highlight=max(dot(N,H),0.0);
  float broad=pow(max(dot(vN,H),0.0),12.0);
  float gloss=pow(highlight,kind==3.0||kind==4.0?92.0:180.0);
  float fresnel=pow(1.0-max(dot(N,V),0.0),4.0);
  float inkTransmission=.08+.92*smoothstep(.018,.30,dot(ink,vec3(.2126,.7152,.0722)));
  float foil=zone.r*foilEnabled*inkTransmission;
  float title=zone.b*foilEnabled;
  float raised=zone.a*foilEnabled;
  // Environmental illumination affects diffuse print independently of the
  // directional foil reflection. Camera exposure still scales both below.
  vec3 color=ink*(.72+.31*lambert)*diffuseIntensity;
  float spectralCoverage=0.;
  vec4 film=vec4(0.);
  // The hologram is fixed to the surface. Its phase depends on incoming and
  // outgoing angles, never on elapsed time or an animated rainbow overlay.
  float phase=dot(incident+sight,vec2(1.5,.57))+vUv.x*.48+vUv.y*.19;
  vec3 diffract=spectrum(phase);
  if(kind<1.5){
    float stripe=pow(max(0.0,1.0-abs(vUv.x*.8+vUv.y*.42+halfAngle.x*2.7-.42)),7.0);
    color+=foil*(ink*.13*broad+diffract*(.16*broad+.26*stripe)*(.3+.7*lambert)+vec3(gloss*.65));
  }
  if(kind==2.0||kind==5.0||kind==6.0){
    color=mix(color,color*.86,foil*.35);
    film=secretFilm(vUv,incident+sight,axisAngles,broad,lambert,inkTransmission);
    color=color*(1.-zone.r*foilEnabled*film.a)+zone.r*foilEnabled*film.rgb+foil*vec3(gloss*.16);
    spectralCoverage=zone.r*foilEnabled*film.a*(1.-title)*(1.-raised);
  }
  if(kind==3.0){
    // Current Japanese relief: fine contours, pebbled frame and glossy edges.
    float cut=pow(highlight,38.0)*relief;
    color+=foil*(ink*.1*broad+diffract*.09*broad);
    color+=vec3(cut*.55+gloss*.35)*foil;
    color*=1.0-relief*.1*(1.0-lambert);
  }
  if(kind==4.0){
    float shard=reliefTex.a;
    float present=smoothstep(.10,.17,shard);
    float facet=pow(max(0.0,cos((shard+halfAngle.x*.9-halfAngle.y*.6)*8.0)),10.0)*present;
    float glass=pow(highlight,42.0)*relief;
    vec3 spectral=spectrum(phase+shard*.67);
    color+=foil*(spectral*(facet*.76*broad+glass*.28)+vec3(gloss*.40));
  }
  if(kind==5.0||kind==3.0){
    // Thin silver foil follows the rounded edge. Its fine etched glints
    // share the face's orders; a shallow edge avoids a thick metal bezel.
    vec2 edgePixels=min(vUv,1.-vUv)*vec2(590.,860.);
    vec2 corner=abs(vUv-.5)*vec2(590.,860.)-vec2(286.,421.);
    float edgeDistance=9.-length(max(corner,0.))-min(max(corner.x,corner.y),0.);
    float edgeAA=max(fwidth(edgeDistance),.5);
    float rim=1.-smoothstep(14.-edgeAA,14.+edgeAA,edgeDistance);
    // The generated mask preserves the window bounds and OF foreground.
    // Both rims then use exactly the same substrate, etch and reflection.
    float insetMask=texture2D(borderMap,vUv).r;
    vec2 frameSize=artFrame.zw-artFrame.xy;
    vec2 framePoint=vec2(vUv.x,1.-vUv.y)*vec2(590.,860.)-artFrame.xy;
    vec2 frameEdges=min(framePoint,frameSize-framePoint);
    if(kind==3.0){
      // UTR has no overframe foreground: use its calibrated picture window.
      float window=step(artWindow.x,pixel.x)*step(pixel.x,artWindow.z)
                  *step(artWindow.y,pixel.y)*step(pixel.y,artWindow.w);
      insetMask=step(0.,frameEdges.x)*step(0.,frameEdges.y)*(1.-window);
    }
    float inset=step(.001,insetMask);
    edgeDistance=mix(edgeDistance,min(frameEdges.x,frameEdges.y),inset);
    edgePixels=mix(edgePixels,frameEdges,inset);
    rim=max(rim,insetMask);
    float core=smoothstep(.6,1.8,edgeDistance)*(1.-smoothstep(11.5,14.,edgeDistance));
    float cut=1.-smoothstep(.5,1.8,edgeDistance);
    float sideBlend=smoothstep(-2.,2.,edgePixels.x-edgePixels.y);
    vec2 frameSide=sign((framePoint-frameSize*.5)*vec2(1.,-1.));
    vec2 side=mix(sign(vUv-.5),frameSide,inset)*vec2(1.-sideBlend,sideBlend);
    vec3 bevelN=normalize(vN+(vT*side.x+vB*side.y)*.08);
    float bevelGloss=pow(max(dot(bevelN,H),0.),95.);
    float bevelBroad=pow(max(dot(bevelN,H),0.),10.);
    float rimPhase=vUv.y*1.08+vUv.x*.45+dot(axisAngles,vec2(2.2,1.45));
    vec3 rimSpectrum=foilSpectrum(rimPhase);
    vec3 silver=vec3(.105,.112,.120)*(.65+.35*lambert);
    // UTR uses the same smooth silver/rainbow bevel without etched facets.
    vec3 rimColor=silver+rimSpectrum*(.08+.85*bevelBroad)*(.16+1.4*bevelBroad)*core
                  +vec3(bevelGloss*(.12+.22*cut));
    if(kind==5.0){
      float along=mix(vUv.y*296.,vUv.x*203.,sideBlend);
      float edgeSeed=cellSeed(vec2(floor(along),floor(edgeDistance*.65)));
      float etch=.32+.68*band(along+edgeSeed*.30,.12+.10*edgeSeed);
      float edgeGroup=cellSeed(vec2(floor(along/3.),floor(edgeDistance*.5)));
      float edgeAngle=dot(incident+sight,vec2(.45,.85));
      float edgeFlash=exp(-pow((edgeAngle-(edgeGroup-.5)*1.5)/.24,2.));
      rimColor=silver+rimSpectrum*(.08+.85*bevelBroad)*(.16+1.4*edgeFlash)*etch*core;
      rimColor+=film.rgb*.38*core+vec3(bevelGloss*(.12+.22*cut));
    }
    rimColor*=1.-.10*smoothstep(12.,14.,edgeDistance);
    color=mix(color,rimColor,rim*foilEnabled);
    spectralCoverage=mix(spectralCoverage,core*.75,rim*foilEnabled);
  }
  if(kind==1.0||kind==3.0){
    vec3 gold=vec3(.83,.60,.19);
    color=mix(color,gold*(.5+.45*lambert)+vec3(1.,.85,.43)*(gloss*.7+broad*.23),title*.94);
  }else if(kind==2.0){
    // Diamond-cut silver name is independent of the card's mirror grains.
    vec2 diamond=vUv*vec2(360.,525.);
    float cut=band(diamond.x+diamond.y,.16)+band(diamond.x-diamond.y,.16);
    vec3 silver=vec3(.47,.50,.53)+vec3((.10+cut*.16)*broad+gloss*.65);
    color=mix(color,silver,title*.94);
  }else if(kind==5.0||kind==6.0){
    vec3 rainbow=vec3(.25)+spectrum(phase+.13)*(.44+.40*broad)+vec3(gloss*.65);
    color=mix(color,rainbow,title*.94);
  }else if(kind==4.0){
    color=mix(color,vec3(.55,.58,.60)*( .6+.5*lambert)+vec3(broad*.28+gloss*.60),title*.94);
  }
  if(kind==6.0){
    float serial=step(vUv.x,.317)*step(vUv.y,.056)*step(.026,vUv.y);
    vec3 metal=mix(spectrum(phase+vUv.y*.8)*.74+vec3(.30),vec3(.86,.64,.22),serial);
    vec3 high=vec3(pow(highlight,65.)*.8);
    color=mix(color,metal*(.62+.54*lambert)+high+vec3(fresnel*.12),raised);
  }
  if(serialPanel>.5){
    vec3 plaque=vec3(.007,.008,.009)*(.86+.14*lambert)*diffuseIntensity;
    vec3 engraving=vec3(.13,.125,.108)*(.86+.14*lambert)*diffuseIntensity
                   +vec3(.018,.017,.014)*broad*foilEnabled;
    color=mix(plaque,engraving,serialGlyph);
  }
  // Independent die for name glyphs, level/rank circles, card-type and
  // spell/trap symbols. Keep printed detail while strengthening hue shifts.
  float icon=texture2D(accentMap,vUv).r*foilEnabled*srArt;
  // Soften the smooth icon foil independently of names and diamond cuts.
  float header=max(title,icon*.75);
  float headerPhase=dot(axisAngles,vec2(.78,.52))+vUv.x*.42+vUv.y*.28;
  vec3 headerSpectrum=foilSpectrum(headerPhase);
  float headerEtch=.74+.26*band(vUv.y*430.+vUv.x*85.,.22);
  float headerLight=.55+.45*pow(max(dot(vN,H),0.),5.);
  float detail=pow(clamp(dot(ink,vec3(.2126,.7152,.0722))*1.5,0.,1.),1.25);
  color=color*(1.-header*.28)+headerSpectrum*header*headerEtch*headerLight*detail*1.9;
  spectralCoverage=max(spectralCoverage,header*.85);
  if(kind==2.0||kind==5.0||kind==6.0){
    vec4 diamonds=iconDiamondFilm(vUv,axisAngles,.16+.84*sqrt(detail));
    color=color*(1.-icon*diamonds.a)+icon*diamonds.rgb;
    spectralCoverage=max(spectralCoverage,icon*diamonds.a);
  }
  // Low-intensity varnish stays on paper too; it never obscures Japanese text.
  color+=vec3(pow(max(dot(vN,H),0.0),380.0)*.075)*(1.-serialPanel)*srArt;
  vec3 radiance=max(color*exposure,vec3(0.));
  gl_FragColor=vec4(radiance,1.0);
  #include <tonemapping_fragment>
  // ACES's highlight desaturation suits white lighting, but washes narrow
  // diffraction colours towards white. Preserve hue only at reflecting
  // facets; diffuse printing and the other finishes retain normal mapping.
  float peak=max(max(radiance.r,radiance.g),radiance.b);
  float mappedPeak=max(max(gl_FragColor.r,gl_FragColor.g),gl_FragColor.b);
  vec3 spectralMapped=radiance*(mappedPeak/max(peak,.0001));
  gl_FragColor.rgb=mix(gl_FragColor.rgb,spectralMapped,spectralCoverage*.85);
  #include <colorspace_fragment>
}`;

function cardGeometry() {
  const width = 2.95,
    height = 4.3,
    radius = 0.045;
  const s = new THREE.Shape();
  const x = -width / 2,
    y = -height / 2;
  s.moveTo(x + radius, y);
  s.lineTo(x + width - radius, y);
  s.quadraticCurveTo(x + width, y, x + width, y + radius);
  s.lineTo(x + width, y + height - radius);
  s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  s.lineTo(x + radius, y + height);
  s.quadraticCurveTo(x, y + height, x, y + height - radius);
  s.lineTo(x, y + radius);
  s.quadraticCurveTo(x, y, x + radius, y);
  const face = new THREE.ShapeGeometry(s, 8);
  const p = face.attributes.position,
    uv = face.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / width + 0.5, p.getY(i) / height + 0.5);
  const points = s.getPoints(8),
    vertices = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    vertices.push(
      a.x,
      a.y,
      -0.008,
      b.x,
      b.y,
      -0.008,
      b.x,
      b.y,
      0.008,
      a.x,
      a.y,
      -0.008,
      b.x,
      b.y,
      0.008,
      a.x,
      a.y,
      0.008,
    );
  }
  const edge = new THREE.BufferGeometry();
  edge.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  edge.computeVertexNormals();
  return { face, edge };
}

export function createFinishMaterial(entry) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      printMap: { value: entry.print },
      finishMap: { value: entry.finish },
      reliefMap: { value: entry.relief },
      borderMap: { value: entry.border },
      accentMap: { value: entry.accent },
      serialMap: { value: entry.serialMap ?? entry.border },
      serialMode: { value: entry.serialMode ?? 0 },
      artFrame: { value: new THREE.Vector4(...entry.data.calibration.frame) },
      artWindow: {
        value: new THREE.Vector4(
          ...(entry.data.calibration.artWindow ?? entry.data.calibration.art),
        ),
      },
      lightPosition: { value: new THREE.Vector3(-3, 4.5, 7) },
      kind: { value: cardFinishKind(entry.data) },
      foilEnabled: { value: 1 },
      reliefEnabled: { value: 1 },
      exposure: { value: 1 },
      diffuseIntensity: { value: 1 },
    },
  });
}

export async function createFinishLibrary(manifest, baseUrl) {
  const loader = new THREE.TextureLoader(),
    owned = [];
  const noBorder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  noBorder.needsUpdate = true;
  owned.push(noBorder);
  const load = async (path, srgb = false) => {
    const map = await loader.loadAsync(new URL(path, baseUrl).href);
    map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.anisotropy = 4;
    owned.push(map);
    return map;
  };
  const maps = await Promise.all(
    manifest.map(async (data) => ({
      data,
      print: await load(data.front, true),
      finish: await load(data.mask),
      relief: await load(data.normal),
      border: data.border ? await load(data.border) : noBorder,
      accent: data.accent ? await load(data.accent) : noBorder,
    })),
  );
  const back = await load('../assets/card-back.jpg', true);
  const { face, edge } = cardGeometry();
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#dad4c6', roughness: 0.84 });
  const backMaterial = new THREE.MeshStandardMaterial({ map: back, roughness: 0.65 });
  const all = [];
  function create(id) {
    const entry = maps.find((e) => e.data.id === id);
    if (!entry) throw new Error(`Unknown finish: ${id}`);
    const material = createFinishMaterial(entry);
    const card = new THREE.Group();
    card.name = `finish-${id}`;
    card.userData = { ...entry.data, finish: material };
    const front = new THREE.Mesh(face, material);
    front.position.z = 0.008;
    front.name = 'printed-finish';
    card.add(front);
    const rim = new THREE.Mesh(edge, edgeMaterial);
    rim.name = 'paper-edge';
    card.add(rim);
    const reverse = new THREE.Mesh(face, backMaterial);
    reverse.rotation.y = Math.PI;
    reverse.position.z = -0.008;
    reverse.name = 'card-back';
    card.add(reverse);
    all.push(card);
    return card;
  }
  return {
    create,
    dispose() {
      all.forEach((c) => c.userData.finish.dispose());
      owned.forEach((m) => m.dispose());
      face.dispose();
      edge.dispose();
      edgeMaterial.dispose();
      backMaterial.dispose();
    },
  };
}
