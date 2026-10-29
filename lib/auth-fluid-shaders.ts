/** Authored HESSARA composition. Numerical reference: PavelDoGreat's MIT
 * WebGL-Fluid-Simulation (advection, divergence, Jacobi pressure, projection).
 * No demo GUI, assets, analytics, bloom chain or random color splats are bundled.
 */
export const fluidVertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }
`;
const header = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
out vec4 pixel;
`;
const interpolation = `
vec4 sampleField(sampler2D field,vec2 at,vec2 cell){
  vec2 grid=at/cell-.5, base=floor(grid), blend=fract(grid);
  vec2 start=(base+.5)*cell;
  return mix(mix(texture(field,start),texture(field,start+vec2(cell.x,0.)),blend.x),
    mix(texture(field,start+vec2(0.,cell.y)),texture(field,start+cell),blend.x),blend.y);
}
`;
export const fluidFragments = {
  transport: header + `
uniform sampler2D velocity, source;
uniform vec2 velocityCell, sourceCell;
uniform float dt, decay;
${interpolation}
void main(){
  vec2 previous=uv-dt*sampleField(velocity,uv,velocityCell).xy;
  pixel=sampleField(source,previous,sourceCell)*exp(-decay*dt);
}
`,
  force: header + `
uniform sampler2D velocity;
uniform float time,dt,aspect;
uniform vec4 pointer;
void main(){
  vec2 p=(uv-.5)*vec2(aspect,1.);
  // Two soft vortices and an analytic curl field inject energy continuously.
  vec2 a=p-vec2(.17*sin(time*.173),.17*cos(time*.127));
  vec2 b=p-vec2(.24*cos(time*.113),-.19*sin(time*.157));
  vec2 swirl=vec2(-a.y,a.x)*exp(-dot(a,a)*8.)*.72;
  swirl-=vec2(-b.y,b.x)*exp(-dot(b,b)*12.)*.58;
  swirl+=vec2(cos(p.y*5.+time*.31)*sin(p.x*3.-time*.19),
    -sin(p.y*5.+time*.31)*cos(p.x*3.-time*.19))*.023;
  vec2 touch=(uv-pointer.xy)*vec2(aspect,1.);
  vec2 push=pointer.zw*exp(-dot(touch,touch)*95.)*.14;
  vec2 v=texture(velocity,uv).xy+dt*(swirl+push);
  pixel=vec4(clamp(v,vec2(-.6),vec2(.6)),0.,1.);
}
`,
  divergence: header + `
uniform sampler2D velocity;
uniform vec2 cell;
void main(){
  vec2 c=texture(velocity,uv).xy;
  float west=uv.x<cell.x ? -c.x : texture(velocity,uv-vec2(cell.x,0.)).x;
  float east=uv.x>1.-cell.x ? -c.x : texture(velocity,uv+vec2(cell.x,0.)).x;
  float south=uv.y<cell.y ? -c.y : texture(velocity,uv-vec2(0.,cell.y)).y;
  float north=uv.y>1.-cell.y ? -c.y : texture(velocity,uv+vec2(0.,cell.y)).y;
  pixel=vec4((east-west+north-south)*.5,0.,0.,1.);
}
`,
  pressure: header + `
uniform sampler2D pressure, divergence;
uniform vec2 cell;
void main(){
  float neighbors=texture(pressure,uv-vec2(cell.x,0.)).x+texture(pressure,uv+vec2(cell.x,0.)).x
    +texture(pressure,uv-vec2(0.,cell.y)).x+texture(pressure,uv+vec2(0.,cell.y)).x;
  pixel=vec4((neighbors-texture(divergence,uv).x)*.25,0.,0.,1.);
}
`,
  project: header + `
uniform sampler2D pressure, velocity;
uniform vec2 cell;
void main(){
  vec2 gradient=vec2(texture(pressure,uv+vec2(cell.x,0.)).x-texture(pressure,uv-vec2(cell.x,0.)).x,
    texture(pressure,uv+vec2(0.,cell.y)).x-texture(pressure,uv-vec2(0.,cell.y)).x);
  vec2 v=texture(velocity,uv).xy-gradient*.5;
  if(uv.x<cell.x||uv.x>1.-cell.x)v.x=0.;
  if(uv.y<cell.y||uv.y>1.-cell.y)v.y=0.;
  pixel=vec4(v,0.,1.);
}
`,
  pigment: header + `
uniform sampler2D dye;
uniform float time,dt,aspect,seed;
void main(){
  vec2 p=(uv-.5)*vec2(aspect,1.);
  float y=p.y;
  float center=.19*sin(y*5.3+time*.137)+.065*sin(y*11.2-time*.181);
  float width=.075+.025*sin(y*7.1+time*.091);
  float across=(p.x-center)/width;
  float shape=exp(-across*across*.57)*(1.-smoothstep(.25,.49,abs(y)));
  float filament=pow(.5+.5*sin(across*15.+y*16.-time*.73),8.);
  float shoulder=exp(-pow((p.x+center*.6+.12)*17.,2.))*(1.-smoothstep(.23,.46,abs(y)));
  vec3 pigment=vec3(shape*(.2+filament*.8),shoulder*.47,shape*.13+shoulder*.1);
  vec3 previous=texture(dye,uv).xyz;
  pixel=vec4(min(previous+pigment*(dt*.65+seed),vec3(3.)),1.);
}
`,
  display: header + `
uniform sampler2D dye;
uniform vec2 cell;
uniform float aspect,time;
${interpolation}
void main(){
  vec3 pigment=sampleField(dye,uv,cell).xyz;
  float thickness=dot(pigment,vec3(.67,.72,.3));
  float dx=length(texture(dye,uv+vec2(cell.x,0.)).xyz)-length(texture(dye,uv-vec2(cell.x,0.)).xyz);
  float dy=length(texture(dye,uv+vec2(0.,cell.y)).xyz)-length(texture(dye,uv-vec2(0.,cell.y)).xyz);
  vec3 normal=normalize(vec3(-dx*7.,-dy*7.,.17));
  float light=max(dot(normal,normalize(vec3(-.5,.7,1.))),0.);
  vec3 snow=vec3(.9686,.9765,.9882);
  vec3 powder=vec3(.7490,.8431,.9176);
  vec3 dolphin=vec3(.3725,.4980,.6510);
  vec2 p=(uv-.5)*vec2(aspect,1.);
  vec3 paper=mix(snow,powder,.12*exp(-dot(p,p)*2.));
  vec3 ink=mix(dolphin,powder,clamp(light*.7+pigment.y*.15,0.,1.));
  float opacity=1.-exp(-thickness*1.28);
  vec3 color=mix(paper,ink,opacity*.91);
  // Silvery ridges come from the simulated density gradient, not an image.
  color=mix(color,vec3(.99),clamp(length(vec2(dx,dy))*1.5,0.,.28)*light);
  float contour=pow(.5+.5*sin(thickness*35.+uv.y*5.),18.);
  color+=vec3(.035)*contour*opacity*light;
  float edge=(1.-smoothstep(.29,.59,length(p*vec2(.92,.75))));
  color=mix(paper,color,edge);
  pixel=vec4(clamp(color,0.,1.),1.);
}
`,
} as const;
