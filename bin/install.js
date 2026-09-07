#!/usr/bin/env node
import { installPlugin } from "../dist/installer.js";
const args = process.argv.slice(2);
const isLocal = args.includes("--local") || args.includes("-l");
installPlugin({ global: !isLocal });
