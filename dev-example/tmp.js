const proto = {
  f() {
    console.log('proto', this.x)
  },
  x: 42,
  g() {},
}
const obj = Object.assign(Object.create(proto), {
  f() {
    console.log('obj', this.x)
    Object.getPrototypeOf(this).f.apply(this)
  },
  x: 43,
})
obj.f()

function struct(o) {
  if (o === Object.prototype) return
  console.log('---', o.constructor.name)
  for (const [n, m] of Object.entries(Object.getOwnPropertyDescriptors(o))) {
    console.log('  ', n, JSON.stringify(m))
  }
  struct(Object.getPrototypeOf(o))
}

struct(obj)
for (const m in obj) {
  console.log(m, typeof obj[m])
}
