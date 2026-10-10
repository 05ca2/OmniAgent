// ORcode 插件：安全数学求值（仅允许数字、运算符与 Math 函数/常数）
export default {
  name: 'calculator',
  description: '数值计算插件：四则运算、三角函数、开方、幂、常数等。',
  tools: [
    {
      name: 'calc',
      description: '计算一个数学表达式。支持 + - * / () 以及 sin cos tan sqrt pow abs log exp floor ceil round min max PI E。例如：calc("sqrt(144) + pow(2,10)")',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: '数学表达式' } },
        required: ['expression'],
      },
      async execute({ expression }, ctx) {
        if (typeof expression !== 'string') return '需要字符串表达式';
        // 白名单：仅允许数字、字母、运算符、括号、点、空格
        if (!/^[0-9a-zA-Z+\-*/().,\s]*$/.test(expression)) return '表达式含不允许的字符';
        try {
          const { sin, cos, tan, sqrt, pow, abs, log, exp, floor, ceil, round, min, max, PI, E } = Math;
          // eslint-disable-next-line no-new-func
          const f = new Function('sin', 'cos', 'tan', 'sqrt', 'pow', 'abs', 'log', 'exp', 'floor', 'ceil', 'round', 'min', 'max', 'PI', 'E',
            'return (' + expression + ');');
          const v = f(sin, cos, tan, sqrt, pow, abs, log, exp, floor, ceil, round, min, max, PI, E);
          return typeof v === 'number' && isFinite(v) ? `= ${v}` : '计算结果不是有限数';
        } catch (e) {
          return '计算错误：' + e.message;
        }
      },
    },
  ],
};
