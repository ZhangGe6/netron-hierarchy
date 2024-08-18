import argparse
import logging
from flask import Flask, render_template, request
logging.basicConfig(level=logging.INFO)

app = Flask(__name__)


@app.route('/')
def index():
    return render_template('index.html')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', type=str, default='127.0.0.1',
                        help='The hostname to listen on. \
                              Set this to "0.0.0.0" to have the server available externally as well')
    parser.add_argument('--port', type=int, default=5000,
                        help='The port of the webserver. Defaults to 5000.')
    parser.add_argument('--debug', type=bool, default=False,
                        help='Enable or disable debug mode.')

    args = parser.parse_args()
    return args


def main():
    args = parse_args()
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == '__main__':
    main()
