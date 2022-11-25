import * as core from '@actions/core';
import action from './action';
import parseArgs from 'minimist';

process.on('unhandledRejection', handleError);
main().catch(handleError);

async function main() {
  // Parse arguments
  const requiredArgs = [
    'awsAccessKeyId',
    'awsSecretAccessKey',
    'owner',
    'releaseTag',
    'repo',
    's3Bucket',
    's3Region',
    'token',
  ];
  const args = parseArgs(process.argv.slice(2), {
    string: requiredArgs.concat([
      's3BucketPublicUrl',
      's3KeyPrefix',
      'doneWhenAssetSuffixesExist',
      'doneIndicatorFileName',
    ]),
  });
  for (const arg of requiredArgs) {
    if (!args[arg]) {
      throw new Error(`Missing required argument: ${arg}`);
    }
  }
  args['s3KeyPrefix'] ??= 'releases/{version-parsed-from-tag}';

  await action({
    ...(args as any),
    debug: true,
  });
}

function handleError(err: any): void {
  console.error(err);
  core.setFailed(`Unhandled error: ${err}`);
}
