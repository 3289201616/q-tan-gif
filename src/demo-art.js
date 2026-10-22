/**
 * An original, procedurally painted plush mascot used before the visitor
 * uploads their own picture. It is transparent so the default "镂空" stage
 * immediately demonstrates the cut-out GIF mode.
 */

export function createDemoPlushCanvas(size = 720) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const s = size / 720
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.scale(s, s)

  // soft ground shadow is intentionally absent: the compositor adds it
  const outline = '#5b3d36'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // ears (behind the body)
  ctx.save()
  ctx.translate(360, 356)
  ctx.rotate(-0.08)
  ctx.beginPath()
  ctx.moveTo(-176, -152)
  ctx.bezierCurveTo(-226, -300, -72, -302, -46, -178)
  ctx.closePath()
  const earGrad = ctx.createLinearGradient(-210, -300, -50, -140)
  earGrad.addColorStop(0, '#c08d6d')
  earGrad.addColorStop(0.55, '#96674f')
  earGrad.addColorStop(1, '#6d4739')
  ctx.fillStyle = earGrad
  ctx.fill()
  ctx.lineWidth = 9
  ctx.strokeStyle = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(176, -152)
  ctx.bezierCurveTo(226, -300, 72, -302, 46, -178)
  ctx.closePath()
  ctx.fillStyle = earGrad
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // long brown side locks, like the cover plush's hair
  ctx.save()
  ctx.fillStyle = '#8a5b46'
  ctx.strokeStyle = outline
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.moveTo(183, 214)
  ctx.bezierCurveTo(116, 306, 95, 436, 128, 570)
  ctx.bezierCurveTo(147, 625, 178, 646, 204, 623)
  ctx.bezierCurveTo(170, 492, 183, 343, 238, 259)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(537, 214)
  ctx.bezierCurveTo(604, 306, 625, 436, 592, 570)
  ctx.bezierCurveTo(573, 625, 542, 646, 516, 623)
  ctx.bezierCurveTo(550, 492, 537, 343, 482, 259)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // main plush body
  ctx.save()
  ctx.translate(360, 372)
  ctx.beginPath()
  ctx.moveTo(-214, 38)
  ctx.bezierCurveTo(-246, -108, -176, -224, -24, -228)
  ctx.bezierCurveTo(144, -233, 246, -111, 228, 46)
  ctx.bezierCurveTo(211, 197, 108, 252, -4, 248)
  ctx.bezierCurveTo(-126, 244, -199, 178, -214, 38)
  ctx.closePath()

  const bodyGrad = ctx.createRadialGradient(-58, -120, 30, 0, 20, 310)
  bodyGrad.addColorStop(0, '#fffaf0')
  bodyGrad.addColorStop(0.44, '#ffe9d8')
  bodyGrad.addColorStop(0.75, '#f7ceb5')
  bodyGrad.addColorStop(1, '#e0a689')
  ctx.fillStyle = bodyGrad
  ctx.shadowColor = 'rgba(76, 74, 96, 0.2)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetY = 17
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 10
  ctx.strokeStyle = outline
  ctx.stroke()
  ctx.restore()

  // inner-ear blush tucked behind the fringe
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#f0a19c'
  ctx.beginPath()
  ctx.ellipse(231, 430, 26, 48, -0.46, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(489, 430, 26, 48, 0.46, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // brown fringe
  ctx.save()
  ctx.translate(360, 242)
  const hairGrad = ctx.createLinearGradient(0, -110, 0, 50)
  hairGrad.addColorStop(0, '#b17b5f')
  hairGrad.addColorStop(0.6, '#8a5b46')
  hairGrad.addColorStop(1, '#6f493b')
  ctx.fillStyle = hairGrad
  ctx.strokeStyle = outline
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.moveTo(-100, -8)
  ctx.bezierCurveTo(-94, -68, -49, -94, 0, -82)
  ctx.bezierCurveTo(50, -95, 95, -68, 101, -8)
  ctx.bezierCurveTo(78, 21, 56, 29, 38, 14)
  ctx.bezierCurveTo(22, 38, -8, 35, -22, 17)
  ctx.bezierCurveTo(-45, 34, -77, 20, -100, -8)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // big glossy eyes
  drawEye(ctx, 276, 366, -0.08)
  drawEye(ctx, 444, 366, 0.08)

  // blush
  ctx.save()
  ctx.globalAlpha = 0.55
  const blush = ctx.createRadialGradient(0, 0, 0, 0, 0, 38)
  blush.addColorStop(0, '#ff9fa6')
  blush.addColorStop(1, 'rgba(255, 159, 166, 0)')
  ctx.fillStyle = blush
  ctx.beginPath()
  ctx.ellipse(224, 446, 45, 30, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(496, 446, 45, 30, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // tiny mouth
  ctx.save()
  ctx.translate(360, 450)
  ctx.strokeStyle = outline
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(-13, -2)
  ctx.quadraticCurveTo(0, 9, 13, -2)
  ctx.stroke()
  ctx.restore()

  // navy sailor collar with cream piping, then the orange ribbon
  ctx.save()
  ctx.translate(360, 0)
  ctx.fillStyle = '#2e3f6b'
  ctx.strokeStyle = outline
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(-154, 511)
  ctx.bezierCurveTo(-68, 540, 68, 540, 154, 511)
  ctx.lineTo(132, 602)
  ctx.bezierCurveTo(72, 625, -72, 625, -132, 602)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#eaf7ff'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(-139, 523)
  ctx.bezierCurveTo(-62, 548, 62, 548, 139, 523)
  ctx.stroke()
  ctx.restore()

  drawBow(ctx, 360, 557)

  // hair clip star
  drawStar(ctx, 544, 278, 25, '#ffd86f', outline, 6)

  // highlight flecks
  ctx.save()
  ctx.globalAlpha = 0.7
  ctx.fillStyle = '#fffdf6'
  ctx.beginPath()
  ctx.ellipse(186, 300, 11, 17, -0.55, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.restore()
  return canvas
}

function drawEye(ctx, x, y, tilt) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  ctx.fillStyle = '#402c2b'
  ctx.strokeStyle = '#402c2b'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.ellipse(0, 0, 34, 44, 0, 0, Math.PI * 2)
  ctx.fill()

  const iris = ctx.createLinearGradient(0, -34, 0, 38)
  iris.addColorStop(0, '#7d64c8')
  iris.addColorStop(0.52, '#bca0ef')
  iris.addColorStop(1, '#7e5dbb')
  ctx.fillStyle = iris
  ctx.beginPath()
  ctx.ellipse(0, 9, 25, 29, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#2e2139'
  ctx.beginPath()
  ctx.ellipse(0, 9, 12, 17, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#fffdf8'
  ctx.beginPath()
  ctx.ellipse(-10, -8, 9, 12, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(11, 18, 4.5, 0, Math.PI * 2)
  ctx.fill()

  // lashes
  ctx.strokeStyle = '#402c2b'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(0, 0, 40, Math.PI * 1.08, Math.PI * 1.8)
  ctx.stroke()
  ctx.restore()
}

function drawBow(ctx, x, y) {
  ctx.save()
  ctx.translate(x, y)
  const outline = '#5b3d36'
  ctx.lineWidth = 7
  ctx.fillStyle = '#ff955c'
  ctx.strokeStyle = outline
  ctx.beginPath()
  ctx.moveTo(-8, 0)
  ctx.bezierCurveTo(-58, -40, -86, -15, -72, 12)
  ctx.bezierCurveTo(-58, 38, -28, 28, -8, 4)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(8, 0)
  ctx.bezierCurveTo(58, -40, 86, -15, 72, 12)
  ctx.bezierCurveTo(58, 38, 28, 28, 8, 4)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(0, 1, 15, 16, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#e8733d'
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawStar(ctx, x, y, radius, fill, stroke, lineWidth) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI / 4) * i - Math.PI / 2
    const r = i % 2 === 0 ? radius : radius * 0.38
    const px = Math.cos(angle) * r
    const py = Math.sin(angle) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
